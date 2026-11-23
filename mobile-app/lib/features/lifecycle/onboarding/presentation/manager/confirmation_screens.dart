import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/confirmation_api.dart';
import '../../data/lifecycle_me_store.dart';
import '../../data/onboarding_api.dart' show onboardingErrorText;
import '../onboarding_kit.dart';
import 'team_kit.dart';

/// The probation decision on the team side, each its own screen (24 Nov:
/// there is no joiner page with tasks any more; HR assigns everything else on
/// the dashboard): the manager's confirmation review (MgrConfReview) and the
/// head of department's approval (HodApprove). Opened from the Actions card
/// "Confirmation review for Priya" / "Approve Priya’s confirmation" while one
/// waits, and from their pushes (`lifecycle_confirmation_review`,
/// `lifecycle_confirmation_approval`). Every value is the server's.

/// Opens [kind]'s screen for [journeyId]; reads `/lifecycle/me` again on the
/// way back, so the Actions card goes once it is done.
Future<void> openConfirmation(
  BuildContext context, {
  required OnboardingShell shell,
  required String journeyId,
  required ConfirmationKind kind,
  ConfirmationApi? api,
}) async {
  final resolved = api ?? HttpConfirmationApi.from(shell.api);
  if (resolved == null) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => kind == ConfirmationKind.review
          ? ConfirmationReviewScreen(shell: shell, api: resolved, journeyId: journeyId)
          : ConfirmationApprovalScreen(shell: shell, api: resolved, journeyId: journeyId),
    ),
  );
  unawaited(LifecycleMeStore.instance.refresh(shell.api));
}

// ─── The manager's review ───────────────────────────────────────────────────

/// MgrConfReview: their probation (the facts, for your review), your
/// recommendation (Confirm / Extend by 1–3 months), three answers, Send to
/// the head of department. Once sent: what went, read only.
class ConfirmationReviewScreen extends StatefulWidget {
  const ConfirmationReviewScreen({super.key, required this.shell, required this.api, required this.journeyId});

  final OnboardingShell shell;
  final ConfirmationApi api;
  final String journeyId;

  static const fields = [
    ('How they did against their KPIs and goals', 'Where they met them, and where not yet'),
    ('What they do well', 'What you’d want them to keep doing'),
    ('What to work on next', 'One or two things for the next six months'),
  ];

  @override
  State<ConfirmationReviewScreen> createState() => _ConfirmationReviewScreenState();
}

class _ConfirmationReviewScreenState extends State<ConfirmationReviewScreen> {
  ConfirmationReview? _view;
  Object? _error;
  String _outcome = 'confirm';
  String _months = '3 months';
  final _answers = [TextEditingController(), TextEditingController(), TextEditingController()];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final a in _answers) {
      a.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final v = await widget.api.review(widget.journeyId);
      if (mounted) setState(() => _view = v);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final v = _view;
    if (v == null) return;
    final missing = ConfirmationReviewScreen.fields.indexed.where((f) => _answers[f.$1].text.trim().isEmpty).map((f) => f.$2.$1).firstOrNull;
    if (missing != null) {
      showConfirmationToast(context, '$missing is needed');
      return;
    }
    setState(() => _busy = true);
    try {
      final sent = await widget.api.sendReview(
        widget.journeyId,
        outcome: _outcome,
        extendMonths: _outcome == 'extend' ? int.parse(_months.split(' ').first) : null,
        kpis: _answers[0].text.trim(),
        strengths: _answers[1].text.trim(),
        next: _answers[2].text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _view = sent;
        _busy = false;
      });
      showConfirmationToast(context, v.approverName == null ? 'Sent to approve' : 'Sent to ${v.approverName!.split(' ').first} to approve');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showConfirmationToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = _view;
    if (v == null) {
      return ConfirmationFrame(
        shell: widget.shell,
        title: 'Confirmation review',
        children: [SizedBox(height: 240, child: OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load))],
      );
    }
    final j = v.joiner;
    final sent = v.sent;
    return ConfirmationFrame(
      shell: widget.shell,
      title: 'Confirmation review',
      onRefresh: _load,
      children: [
        ConfirmationHeader(
          joiner: j,
          title: '${j.first}’s confirmation review',
          line: j.roleLine ?? j.name,
          pill: sent == null ? null : 'Sent',
        ),
        if (v.facts.isNotEmpty) ...[
          const ConfirmationBlockLabel('Their probation', meta: 'For your review'),
          ConfirmationFacts(facts: v.facts),
        ],
        if (sent != null) ...[
          ConfirmationNote(
            key: const ValueKey('confirmation-sent'),
            heading: 'You recommended: ${sent.label}',
            body: v.approverName == null ? 'Waiting for the head of department to approve.' : 'Waiting for ${v.approverName} to approve.',
          ),
          for (final (q, a) in [
            (ConfirmationReviewScreen.fields[0].$1, sent.kpis),
            (ConfirmationReviewScreen.fields[1].$1, sent.strengths),
            (ConfirmationReviewScreen.fields[2].$1, sent.next),
          ])
            if (a.isNotEmpty) ConfirmationAnswer(question: q, answer: a),
        ] else ...[
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const ConfirmationLabel('Your recommendation'),
              const SizedBox(height: 8),
              ConfirmationSegmented(
                options: const [('confirm', 'Confirm'), ('extend', 'Extend')],
                selected: _outcome,
                onSelect: (o) => setState(() => _outcome = o),
              ),
            ],
          ),
          if (_outcome == 'extend')
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const ConfirmationLabel('Extend by'),
                const SizedBox(height: 8),
                ConfirmationChoices(options: const ['1 month', '2 months', '3 months'], selected: _months, onSelect: (m) => setState(() => _months = m)),
              ],
            ),
          for (final (i, (t, ph)) in ConfirmationReviewScreen.fields.indexed)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ConfirmationLabel(t),
                const SizedBox(height: 8),
                ConfirmationTextBox(key: ValueKey('confirmation-field-$i'), controller: _answers[i], hint: ph, label: t),
              ],
            ),
          ConfirmationPrimaryButton(v.approverName == null ? 'Send' : 'Send to ${v.approverName!.split(' ').first}', busy: _busy, onTap: _send),
        ],
      ],
    );
  }
}

// ─── The head of department's approval ──────────────────────────────────────

/// HodApprove: "Dev’s confirmation", who recommended it and when, the three
/// answers, the recommendation and its note, the facts, your comments, and
/// Approve or Extend (by 1, 2 or 3 months).
class ConfirmationApprovalScreen extends StatefulWidget {
  const ConfirmationApprovalScreen({super.key, required this.shell, required this.api, required this.journeyId});

  final OnboardingShell shell;
  final ConfirmationApi api;
  final String journeyId;

  @override
  State<ConfirmationApprovalScreen> createState() => _ConfirmationApprovalScreenState();
}

class _ConfirmationApprovalScreenState extends State<ConfirmationApprovalScreen> {
  final _voice = TeamVoice();
  final _comment = TextEditingController();
  ConfirmationApproval? _view;
  Object? _error;
  bool _extend = false;
  String _months = '3 months';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _comment.dispose();
    _voice.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final v = await widget.api.approval(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _view = v;
        if (v.answerComment != null && _comment.text.isEmpty) _comment.text = v.answerComment!;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _answer(String action) async {
    final months = int.parse(_months.split(' ').first);
    final rec = _view?.recommendation;
    setState(() => _busy = true);
    try {
      final v = await widget.api.answerApproval(widget.journeyId, action, extendMonths: action == 'extend' ? months : null, comment: _comment.text);
      if (!mounted) return;
      setState(() {
        _view = v;
        _busy = false;
        _extend = false;
      });
      // Approving a recommendation to extend extends, by the manager's months.
      final recMonths = rec?.extendMonths ?? 3;
      showConfirmationToast(
        context,
        action == 'approve'
            ? (rec?.outcome == 'extend' ? 'Probation extended by $recMonths month${recMonths == 1 ? '' : 's'}' : 'Confirmation approved')
            : 'Probation extended by $_months',
      );
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showConfirmationToast(context, onboardingErrorText(e));
      }
    }
  }

  static String _first(String name) => name.trim().split(RegExp(r'\s+')).first;

  @override
  Widget build(BuildContext context) {
    final v = _view;
    if (v == null) {
      return ConfirmationFrame(
        shell: widget.shell,
        title: 'Approve confirmation',
        children: [SizedBox(height: 240, child: OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load))],
      );
    }
    final j = v.joiner;
    final rec = v.recommendation;
    final by = rec?.byName ?? '';
    final (pill, bg, fg) = switch (v.state) {
      'approved' => ('Approved', TeamColors.okBg, TeamColors.okFg),
      'extended' => ('Extended', TeamColors.warnBg, TeamColors.warnFg),
      'ready' => ('To approve', TeamColors.blueBg, OnbColors.primary),
      _ => ('Waiting', OnbColors.quiet, OnbColors.text3),
    };
    final ready = v.state == 'ready';
    final at = rec?.at;
    return ConfirmationFrame(
      shell: widget.shell,
      title: 'Approve confirmation',
      onRefresh: _load,
      children: [
        ConfirmationHeader(
          joiner: j,
          title: '${j.first}’s confirmation',
          line: at == null || by.isEmpty ? (j.roleLine ?? j.name) : 'Recommended ${confirmationAgo(at, widget.shell.now())} by ${_first(by)}',
          pill: pill,
          pillBg: bg,
          pillFg: fg,
        ),
        if (rec == null)
          ConfirmationNote(heading: 'Waiting for the manager’s review', body: 'You can approve once ${j.first}’s manager has sent their recommendation.', tone: ConfirmationTone.quiet)
        else ...[
          ConfirmationNote(key: const ValueKey('confirmation-recommends'), heading: '$by recommends: ${rec.label}', body: rec.note),
          for (final (q, a) in [
            (ConfirmationReviewScreen.fields[0].$1, rec.kpis),
            (ConfirmationReviewScreen.fields[1].$1, rec.strengths),
            (ConfirmationReviewScreen.fields[2].$1, rec.next),
          ])
            if (a.isNotEmpty) ConfirmationAnswer(question: q, answer: a),
        ],
        if (v.facts.isNotEmpty) ConfirmationFacts(facts: v.facts),
        if (rec != null)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const ConfirmationLabel('Your comments'),
              const SizedBox(height: 8),
              TeamNotesField(field: 'approval', controller: _comment, voice: _voice, label: 'Your comments', hint: 'What you’d like ${j.first} to know', filled: false, minLines: 3),
              const SizedBox(height: 8),
              Text('${_first(by)}, ${j.first} and HR see your comments.', style: OnbText.label),
            ],
          ),
        if (ready && _extend)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const ConfirmationLabel('Extend probation by'),
              const SizedBox(height: 8),
              ConfirmationChoices(options: const ['1 month', '2 months', '3 months'], selected: _months, onSelect: (m) => setState(() => _months = m)),
            ],
          ),
        if (ready)
          Row(
            children: [
              Expanded(
                flex: 10,
                child: ConfirmationSecondaryButton(_extend ? 'Cancel' : 'Extend', onTap: _busy ? null : () => setState(() => _extend = !_extend)),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 14,
                child: ConfirmationPrimaryButton(
                  _extend ? 'Extend by $_months' : rec?.outcome == 'extend' ? 'Approve extension' : 'Approve',
                  busy: _busy,
                  onTap: () => _answer(_extend ? 'extend' : 'approve'),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

/// "today", "yesterday", "3 days ago".
String confirmationAgo(DateTime at, DateTime now) {
  final days = DateTime(now.year, now.month, now.day).difference(DateTime(at.year, at.month, at.day)).inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'yesterday';
  return '$days days ago';
}

/// The kit's toast: the message and OK.
void showConfirmationToast(BuildContext context, String text) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        key: const ValueKey('confirmation-toast'),
        backgroundColor: TeamColors.ink,
        behavior: SnackBarBehavior.floating,
        elevation: 6,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        duration: const Duration(seconds: 4),
        content: Row(
          children: [
            Expanded(child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white))),
            const SizedBox(width: 10),
            TextButton(
              style: TextButton.styleFrom(
                backgroundColor: const Color(0x29FFFFFF),
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 36),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              onPressed: messenger.hideCurrentSnackBar,
              child: const Text('OK'),
            ),
          ],
        ),
      ),
    );
}

/// The screen: the app's header, back + title, the blocks 14 apart, the tabs.
class ConfirmationFrame extends StatelessWidget {
  const ConfirmationFrame({super.key, required this.shell, required this.title, required this.children, this.onRefresh});

  final OnboardingShell shell;
  final String title;
  final List<Widget> children;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 14), children[i]],
      ],
    );
    return OnbScaffold(
      shell: shell,
      title: title,
      body: onRefresh == null ? list : RefreshIndicator(color: OnbColors.primary, onRefresh: onRefresh!, child: list),
    );
  }
}

/// The top card: the joiner's face, the title, a line, a pill.
class ConfirmationHeader extends StatelessWidget {
  const ConfirmationHeader({super.key, required this.joiner, required this.title, required this.line, this.pill, this.pillBg = TeamColors.okBg, this.pillFg = TeamColors.okFg});

  final ConfirmationJoiner joiner;
  final String title;
  final String line;
  final String? pill;
  final Color pillBg;
  final Color pillFg;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('confirmation-header'),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OnbAvatar(name: joiner.name, photoUrl: joiner.photoUrl, size: 52),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, height: 1.3, fontWeight: FontWeight.w700, color: TeamColors.ink)),
              if (line.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(line, maxLines: 2, overflow: TextOverflow.ellipsis, style: OnbText.label),
              ],
              if (pill != null) ...[const SizedBox(height: 8), TeamPill(pill!, background: pillBg, foreground: pillFg, height: 26)],
            ],
          ),
        ),
      ],
    ),
  );
}

/// The facts as label · value rows in one white card.
class ConfirmationFacts extends StatelessWidget {
  const ConfirmationFacts({super.key, required this.facts});

  final List<ConfirmationFact> facts;

  @override
  Widget build(BuildContext context) => ConfirmationCard(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    children: [
      for (final (i, f) in facts.indexed)
        Container(
          constraints: const BoxConstraints(minHeight: 46),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: OnbColors.line))),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(f.label, style: const TextStyle(fontSize: 14, height: 20 / 14, color: OnbColors.text3)),
              const SizedBox(width: 16),
              Expanded(
                child: Text(f.value, textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
              ),
            ],
          ),
        ),
    ],
  );
}

/// A question and its answer, read only.
class ConfirmationAnswer extends StatelessWidget {
  const ConfirmationAnswer({super.key, required this.question, required this.answer});

  final String question;
  final String answer;

  @override
  Widget build(BuildContext context) => ConfirmationCard(
    padding: const EdgeInsets.all(14),
    children: [
      Text(question, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
      const SizedBox(height: 6),
      Text(answer, style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
    ],
  );
}

enum ConfirmationTone { ok, quiet }

/// A tinted note: what was recommended, or what it waits for.
class ConfirmationNote extends StatelessWidget {
  const ConfirmationNote({super.key, required this.heading, this.body, this.tone = ConfirmationTone.ok});

  final String heading;
  final String? body;
  final ConfirmationTone tone;

  @override
  Widget build(BuildContext context) {
    final ok = tone == ConfirmationTone.ok;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: ok ? TeamColors.okBg : OnbColors.quiet, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(heading, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: ok ? TeamColors.okFg : OnbColors.text2)),
          if (body != null && body!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(body!, style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
          ],
        ],
      ),
    );
  }
}

/// A white card with rows.
class ConfirmationCard extends StatelessWidget {
  const ConfirmationCard({super.key, required this.children, this.padding = EdgeInsets.zero});

  final List<Widget> children;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    clipBehavior: Clip.antiAlias,
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}

/// A grey upper-case label over a block, with its meta on the right.
class ConfirmationBlockLabel extends StatelessWidget {
  const ConfirmationBlockLabel(this.text, {super.key, this.meta});

  final String text;
  final String? meta;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 6, 2, 0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Expanded(child: Text(text.toUpperCase(), style: OnbText.eyebrow)),
        if (meta != null) Text(meta!, style: OnbText.label),
      ],
    ),
  );
}

/// A bold label over a field.
class ConfirmationLabel extends StatelessWidget {
  const ConfirmationLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink));
}

/// A plain text box (white, a darker line).
class ConfirmationTextBox extends StatelessWidget {
  const ConfirmationTextBox({super.key, required this.controller, this.hint, this.label});

  final TextEditingController controller;
  final String? hint;
  final String? label;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    child: TextField(
      controller: controller,
      minLines: 3,
      maxLines: 10,
      textCapitalization: TextCapitalization.sentences,
      style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(fontSize: 14, color: OnbColors.text3),
        isDense: true,
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.lineDark)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.primary)),
      ),
    ),
  );
}

/// Two options on a grey track ("Confirm" / "Extend").
class ConfirmationSegmented extends StatelessWidget {
  const ConfirmationSegmented({super.key, required this.options, required this.selected, required this.onSelect});

  final List<(String, String)> options;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(color: OnbColors.line, borderRadius: BorderRadius.circular(14)),
    child: Row(
      children: [
        for (final (i, (value, label)) in options.indexed) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: Semantics(
              selected: value == selected,
              button: true,
              child: GestureDetector(
                key: ValueKey('confirmation-seg-$value'),
                onTap: () => onSelect(value),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  constraints: const BoxConstraints(minHeight: 40),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: value == selected ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(11),
                    boxShadow: value == selected ? const [BoxShadow(color: Color(0x1F000000), blurRadius: 3, offset: Offset(0, 1))] : null,
                  ),
                  child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                ),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

/// Choice buttons in a row ("1 month", "2 months", "3 months").
class ConfirmationChoices extends StatelessWidget {
  const ConfirmationChoices({super.key, required this.options, required this.selected, required this.onSelect});

  final List<String> options;
  final String? selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      for (final (i, t) in options.indexed) ...[
        if (i > 0) const SizedBox(width: 8),
        Expanded(
          child: Semantics(
            selected: t == selected,
            button: true,
            child: GestureDetector(
              key: ValueKey('confirmation-choice-$t'),
              onTap: () => onSelect(t),
              child: Container(
                constraints: const BoxConstraints(minHeight: 40),
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: t == selected ? OnbColors.primary : Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: t == selected ? null : Border.all(color: OnbColors.lineDark),
                ),
                child: Text(
                  t,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: t == selected ? Colors.white : TeamColors.ink),
                ),
              ),
            ),
          ),
        ),
      ],
    ],
  );
}

/// The blue button at the foot of a screen.
class ConfirmationPrimaryButton extends StatelessWidget {
  const ConfirmationPrimaryButton(this.label, {super.key, required this.onTap, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 52),
    child: FilledButton(
      key: ValueKey('confirmation-button-$label'),
      style: FilledButton.styleFrom(
        backgroundColor: OnbColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      onPressed: busy ? null : onTap,
      child: busy
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
          : Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
    ),
  );
}

/// The white button beside it ("Extend", "Cancel").
class ConfirmationSecondaryButton extends StatelessWidget {
  const ConfirmationSecondaryButton(this.label, {super.key, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton(
    key: ValueKey('confirmation-button-$label'),
    style: OutlinedButton.styleFrom(
      foregroundColor: TeamColors.ink,
      minimumSize: const Size.fromHeight(52),
      side: const BorderSide(color: OnbColors.lineDark),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    ),
    onPressed: onTap,
    child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
  );
}
