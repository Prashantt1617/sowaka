import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import 'joiner_lens.dart';
import 'joiner_meetings.dart';
import 'joiner_models.dart';
import 'joiner_parts.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "In 6 days · 2 Dec".
String nextTalkText(NextTalk t) {
  final when = inDaysText(t.inDays);
  return '${when[0].toUpperCase()}${when.substring(1)} · ${t.on.day} ${_months[t.on.month - 1]}';
}

/// Your goals (New joiner canvas, App · goals): this month's goals, each
/// with a soft "How’s it going?" (Just started, Making progress, Going
/// well), an optional note and the manager's comment after the monthly
/// talk; "Next talk with …" opens the Monthly goals meeting; earlier months
/// stay collapsed underneath, most recent first. No pass or fail.
class JoinerGoalsScreen extends StatefulWidget {
  const JoinerGoalsScreen({super.key, required this.c});

  final JoinerController c;

  @override
  State<JoinerGoalsScreen> createState() => _JoinerGoalsScreenState();
}

class _JoinerGoalsScreenState extends State<JoinerGoalsScreen> {
  JoinerGoals? _g;
  String? _error;
  final Map<int, TextEditingController> _drafts = {};
  final Set<int> _editing = {};
  final Set<int> _open = {};

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in _drafts.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final g = await widget.c.api.fetchGoals();
      if (mounted) {
        setState(() {
          _g = g;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  Future<void> _save(int index, {String? status, String? note}) async {
    final g = _g;
    if (g == null) return;
    try {
      final next = await widget.c.api.saveGoal(g.month, index, status: status, note: note);
      if (mounted) setState(() => _g = next);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    }
  }

  void _toggleNote(GoalView goal) {
    final i = goal.index;
    if (_editing.contains(i)) {
      final text = _drafts[i]?.text.trim() ?? '';
      setState(() => _editing.remove(i));
      if (text != (goal.note ?? '')) unawaited(_save(i, note: text));
    } else {
      (_drafts[i] ??= TextEditingController()).text = goal.note ?? '';
      setState(() => _editing.add(i));
    }
  }

  void _openMeeting(JoinerGoals g) {
    final d = widget.c.data;
    final meetings = d?.meetings.where((m) => m.everyMonth).toList() ?? const <JoinerMeeting>[];
    final m = meetings.where((m) => m.month == g.month).firstOrNull ?? meetings.firstOrNull;
    if (m == null || m.locked) return;
    unawaited(pushJoiner(context, widget.c, JoinerMeetingScreen(c: widget.c, id: m.id)));
  }

  @override
  Widget build(BuildContext context) {
    final g = _g;
    return OnbScaffold(
      shell: widget.c.shell,
      title: 'Your goals',
      offline: g != null && _error != null,
      body: g == null ? OnbLoadState(error: _error, onRetry: _load) : _body(g),
    );
  }

  Widget _body(JoinerGoals g) {
    final manager = g.managerName ?? g.nextTalk?.withName;
    final talk = g.nextTalk;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          JSectionHead(title: 'This month', meta: plural(g.current.length, 'goal', 'goals')),
          for (final goal in g.current) ...[const SizedBox(height: 10), _goalCard(goal, manager)],
          if (talk != null) ...[
            const SizedBox(height: 10),
            Semantics(
              button: true,
              label: 'Next talk with ${_first(manager)}. ${nextTalkText(talk)}',
              excludeSemantics: true,
              child: Material(
                key: const ValueKey('next-talk'),
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: OnbColors.text, width: 1.5)),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => _openMeeting(g),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 60),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    child: Row(
                      children: [
                        JFace(name: manager ?? 'Manager', role: 'manager', size: 36),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Next talk with ${_first(manager)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: OnbColors.text)),
                              const SizedBox(height: 2),
                              Text(nextTalkText(talk), style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
          if (g.earlier.isNotEmpty) ...[
            const SizedBox(height: 22),
            Semantics(header: true, child: const Text('Earlier months', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
            const SizedBox(height: 10),
            JListCard(
              children: [
                for (final (k, m) in g.earlier.indexed) ...[
                  _monthHead(m.month, m.goals.length, last: k == g.earlier.length - 1),
                  if (_open.contains(m.month))
                    for (final goal in m.goals) _pastGoal(goal, m.goals.last == goal && k == g.earlier.length - 1),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  static String _first(String? name) => name == null ? 'your manager' : name.trim().split(RegExp(r'\s+')).first;

  Widget _goalCard(GoalView goal, String? manager) {
    final i = goal.index;
    final editing = _editing.contains(i);
    final note = goal.note ?? '';
    return Container(
      key: ValueKey('goal-$i'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(goal.text, style: const TextStyle(fontSize: 15, height: 1.35, fontWeight: FontWeight.w700, color: OnbColors.text)),
          const SizedBox(height: 12),
          const Text('How’s it going?', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3)),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final (k, e) in goalStatusLabels.entries.indexed) ...[
                if (k > 0) const SizedBox(width: 6),
                Expanded(
                  child: _Segment(
                    key: ValueKey('goal-$i-${e.key}'),
                    label: e.value,
                    on: goal.status == e.key,
                    onTap: () => _save(i, status: e.key),
                  ),
                ),
              ],
            ],
          ),
          if (note.isNotEmpty && !editing) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: OnbColors.screen, borderRadius: BorderRadius.circular(12)),
              child: Text(note, style: const TextStyle(fontSize: 13, height: 1.5, color: OnbColors.text2)),
            ),
          ],
          if (editing) ...[
            const SizedBox(height: 12),
            TextField(
              key: ValueKey('goal-$i-note'),
              controller: _drafts[i],
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              style: const TextStyle(fontSize: 14, color: OnbColors.text),
              decoration: InputDecoration(
                hintText: 'A line on how it’s going',
                counterText: '',
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.lineDark)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.primary)),
              ),
            ),
          ],
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: ValueKey('goal-$i-note-button'),
              onPressed: () => _toggleNote(goal),
              style: TextButton.styleFrom(
                foregroundColor: OnbColors.primary,
                padding: EdgeInsets.zero,
                minimumSize: const Size(0, 32),
                textStyle: OnbText.button(context, size: 13, weight: FontWeight.w700),
              ),
              child: Text(editing ? 'Done' : (note.isEmpty ? 'Add a note' : 'Edit note')),
            ),
          ),
          if (goal.comment != null) ...[
            const Divider(height: 13, thickness: 1, color: OnbColors.line),
            const SizedBox(height: 0),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                JFace(name: goal.commentByName ?? manager ?? 'Manager', role: 'manager', size: 28),
                const SizedBox(width: 10),
                Expanded(child: Text(goal.comment!, style: const TextStyle(fontSize: 13, height: 1.5, color: OnbColors.text))),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _monthHead(int month, int count, {required bool last}) {
    final open = _open.contains(month);
    return Semantics(
      button: true,
      expanded: open,
      label: 'Month $month. ${plural(count, 'goal', 'goals')}',
      excludeSemantics: true,
      child: InkWell(
        key: ValueKey('earlier-$month'),
        onTap: () => setState(() => open ? _open.remove(month) : _open.add(month)),
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(border: last && !open ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
          child: Row(
            children: [
              Expanded(child: Text('Month $month', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: OnbColors.text))),
              Text(plural(count, 'goal', 'goals'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3)),
              const SizedBox(width: 10),
              Container(
                width: 26,
                height: 26,
                decoration: const BoxDecoration(color: OnbColors.screen, shape: BoxShape.circle),
                child: Icon(open ? Icons.remove_rounded : Icons.add_rounded, size: 16, color: OnbColors.text2),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pastGoal(GoalView goal, bool last) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: const Color(0xFFFCFCFD), border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(goal.text, style: const TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w600, color: OnbColors.text))),
            if (goal.status != null) ...[
              const SizedBox(width: 10),
              Container(
                height: 22,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: OnbColors.screen, borderRadius: BorderRadius.circular(999)),
                child: Text(goalStatusLabels[goal.status] ?? '', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.text2)),
              ),
            ],
          ],
        ),
        if (goal.comment != null) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              JFace(name: goal.commentByName ?? 'Manager', role: 'manager', size: 22),
              const SizedBox(width: 8),
              Expanded(child: Text(goal.comment!, style: const TextStyle(fontSize: 12, height: 1.5, color: OnbColors.text2))),
            ],
          ),
        ],
      ],
    ),
  );
}

class _Segment extends StatelessWidget {
  const _Segment({super.key, required this.label, required this.on, required this.onTap});

  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    inMutuallyExclusiveGroup: true,
    checked: on,
    button: true,
    label: label,
    excludeSemantics: true,
    child: Material(
      color: on ? OnbColors.primary : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: on ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: 6),
          alignment: Alignment.center,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : OnbColors.text),
          ),
        ),
      ),
    ),
  );
}
