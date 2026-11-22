import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/onboarding_api.dart' show onboardingErrorText;
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import 'team_joiner_screens.dart';
import 'team_kit.dart';

/// The team side's task screens (canvas "3 · App · teammates"): a meeting
/// (agenda, own notes, voice typing), a check-in to read, the head of
/// department's approval, and the tasks that need more than a tick — assign
/// a buddy, schedule the first-week meetings, the welcome message, the feed
/// post, goal comments, the confirmation review, the office round, a how-to
/// task, and meeting the new joiners. Every value is the server's.

/// Opens [row]'s screen. [fromAll]: opened from View all (the title reads "All tasks").
Future<void> openTeamTask(BuildContext context, TeamPageController controller, TeamTask row, {bool fromAll = false}) async {
  final title = fromAll ? 'All tasks' : (controller.page?.joiner.name ?? '');
  Widget? screen = switch (row.opens) {
    'meeting' => TeamMeetingScreen(controller: controller, rowId: row.id, title: title),
    'checkin' => TeamCheckinScreen(controller: controller, row: row, title: title),
    'approval' => TeamApprovalScreen(controller: controller, row: row, title: title),
    'buddy' => TeamAssignBuddyScreen(controller: controller, row: row, title: title),
    'schedule' => TeamScheduleScreen(controller: controller, row: row, title: title),
    'chat' => TeamMessageScreen(controller: controller, row: row, title: title, post: false),
    'feed' => TeamMessageScreen(controller: controller, row: row, title: title, post: true),
    'goals' => TeamGoalsScreen(controller: controller, row: row, title: title),
    'review' => TeamConfReviewScreen(controller: controller, row: row, title: title),
    'around' => TeamAroundScreen(controller: controller, row: row, title: title),
    'invite' => TeamInviteScreen(controller: controller, row: row, title: title),
    'groups' => TeamPlainScreen(controller: controller, row: row, title: title, button: 'Done', toast: 'Added to the groups'),
    'plain' => TeamPlainScreen(controller: controller, row: row, title: title, button: 'Mark as done', toast: 'Marked as done'),
    _ => null,
  };
  if (screen == null) return;
  await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => screen));
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

/// "Priya’s", for the copy.
String teamPossessive(String first) => '$first’s';

/// "9:30 am", "11 am".
String teamClock(DateTime at) {
  final h = at.hour % 12 == 0 ? 12 : at.hour % 12;
  final m = at.minute == 0 ? '' : ':${at.minute.toString().padLeft(2, '0')}';
  return '$h$m ${at.hour < 12 ? 'am' : 'pm'}';
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "Wed, 2 pm".
String teamDayClock(DateTime at) => '${_weekdays[at.weekday - 1]}, ${teamClock(at)}';

/// "today", "yesterday", "3 days ago".
String teamAgo(DateTime at, DateTime now) {
  final days = DateTime(now.year, now.month, now.day).difference(DateTime(at.year, at.month, at.day)).inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'yesterday';
  return '$days days ago';
}

/// Closes the screen and says what happened on the page under it.
void _finish(BuildContext context, String message) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  Navigator.of(context).maybePop();
  if (messenger != null) showTeamToastOn(messenger, message);
}

/// The screen's top card: the joiner's face, the title, a line, a pill.
class TeamTaskHeader extends StatelessWidget {
  const TeamTaskHeader({super.key, required this.joiner, required this.title, required this.line, this.pill, this.pillBg = TeamColors.okBg, this.pillFg = OnbColors.successText});

  final TeamJoiner joiner;
  final String title;
  final String line;
  final String? pill;
  final Color pillBg;
  final Color pillFg;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('team-task-header'),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
    child: Row(
      children: [
        OnbAvatar(name: joiner.name, photoUrl: joiner.photoUrl, size: 52),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 17, height: 1.3, fontWeight: FontWeight.w700, color: TeamColors.ink)),
              if (line.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(line, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              ],
            ],
          ),
        ),
        if (pill != null) ...[const SizedBox(width: 8), TeamPill(pill!, background: pillBg, foreground: pillFg, height: 26)],
      ],
    ),
  );
}

/// HR's how-to line behind an (i).
class TeamHowBox extends StatelessWidget {
  const TeamHowBox(this.how, {super.key});

  final String how;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('team-how'),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.info_outline_rounded, size: 18, color: OnbColors.primary)),
        const SizedBox(width: 10),
        Expanded(child: Text(how, style: const TextStyle(fontSize: 13, height: 1.5, color: TeamColors.ink))),
      ],
    ),
  );
}

/// The blue button at the foot of a screen.
class TeamPrimaryButton extends StatelessWidget {
  const TeamPrimaryButton(this.label, {super.key, required this.onTap, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 52,
    child: FilledButton(
      key: ValueKey('team-button-$label'),
      style: FilledButton.styleFrom(
        backgroundColor: OnbColors.primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      onPressed: busy ? null : onTap,
      child: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(label),
    ),
  );
}

/// The white button beside it ("Extend", "Cancel").
class TeamSecondaryButton extends StatelessWidget {
  const TeamSecondaryButton(this.label, {super.key, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 52,
    child: OutlinedButton(
      key: ValueKey('team-button-$label'),
      style: OutlinedButton.styleFrom(
        foregroundColor: TeamColors.ink,
        side: const BorderSide(color: OnbColors.lineDark),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
      onPressed: onTap,
      child: Text(label),
    ),
  );
}

/// Two options on a grey track ("Confirm" / "Extend", "One to one" / "With other new joiners").
class TeamSegmented extends StatelessWidget {
  const TeamSegmented({super.key, required this.options, required this.selected, required this.onSelect});

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
                key: ValueKey('team-seg-$value'),
                onTap: () => onSelect(value),
                child: Container(
                  height: 40,
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
class TeamChoices extends StatelessWidget {
  const TeamChoices({super.key, required this.options, required this.selected, required this.onSelect, this.expand = true});

  final List<String> options;
  final String? selected;
  final ValueChanged<String> onSelect;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    Widget chip(String t) {
      final on = t == selected;
      return Semantics(
        selected: on,
        button: true,
        child: GestureDetector(
          key: ValueKey('team-choice-$t'),
          onTap: () => onSelect(t),
          child: Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: on ? OnbColors.primary : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: on ? null : Border.all(color: OnbColors.lineDark),
            ),
            child: Text(t, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: on ? Colors.white : TeamColors.ink)),
          ),
        ),
      );
    }

    return Row(
      children: [
        for (final (i, t) in options.indexed) ...[
          if (i > 0) const SizedBox(width: 8),
          if (expand) Expanded(child: chip(t)) else chip(t),
        ],
      ],
    );
  }
}

/// A bold label over a block.
class TeamLabel extends StatelessWidget {
  const TeamLabel(this.text, {super.key, this.small = false});

  final String text;
  final bool small;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: small
        ? const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)
        : const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink),
  );
}

/// A plain text box (white, a darker line).
class TeamTextBox extends StatelessWidget {
  const TeamTextBox({super.key, required this.controller, this.hint, this.minLines = 3, this.label});

  final TextEditingController controller;
  final String? hint;
  final int minLines;
  final String? label;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    child: TextField(
      controller: controller,
      minLines: minLines,
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

/// A white card with rows.
class TeamCard extends StatelessWidget {
  const TeamCard({super.key, required this.children, this.padding = EdgeInsets.zero});

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

/// A screen around a task: the frame, the joiner from the page.
class _TaskFrame extends StatelessWidget {
  const _TaskFrame({required this.controller, required this.title, required this.children});

  final TeamPageController controller;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => TeamFrame(shell: controller.shell, title: title, children: children);
}

/// The row as the page has it now (it may have changed while the screen was open).
TeamTask _fresh(TeamPageController c, TeamTask row) => c.row(row.id) ?? row;

// ─── A meeting ──────────────────────────────────────────────────────────────

/// MgrMeeting: who it is with, the agenda with my own notes under each point
/// (voice typing), Mark as done / Done, and the privacy line.
class TeamMeetingScreen extends StatefulWidget {
  const TeamMeetingScreen({super.key, required this.controller, required this.rowId, required this.title});

  final TeamPageController controller;
  final String rowId;
  final String title;

  @override
  State<TeamMeetingScreen> createState() => _TeamMeetingScreenState();
}

class _TeamMeetingScreenState extends State<TeamMeetingScreen> {
  final _voice = TeamVoice();
  late final List<String> _agenda;
  late final List<TextEditingController> _notes;
  Timer? _save;
  bool _dirty = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    final row = _c.row(widget.rowId);
    _agenda = (row?.agenda.isNotEmpty ?? false) ? row!.agenda : const ['Anything to talk about'];
    _notes = [
      for (var i = 0; i < _agenda.length; i++)
        TextEditingController(text: i < (row?.notes.length ?? 0) ? row!.notes[i] : '')..addListener(_changed),
    ];
  }

  void _changed() {
    _dirty = true;
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 900), _persist);
  }

  Future<void> _persist() async {
    if (!_dirty) return;
    _dirty = false;
    try {
      await _c.api.saveNotes(_c.journeyId, widget.rowId, [for (final n in _notes) n.text]);
    } catch (_) {
      _dirty = true;
    }
  }

  @override
  void dispose() {
    _save?.cancel();
    unawaited(_persist());
    for (final n in _notes) {
      n.dispose();
    }
    _voice.dispose();
    super.dispose();
  }

  Future<void> _toggle(TeamTask row) async {
    try {
      await _c.tick(row);
    } catch (e) {
      if (mounted) showTeamToast(context, onboardingErrorText(e));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      final row = _c.row(widget.rowId);
      if (page == null || row == null) return _TaskFrame(controller: _c, title: widget.title, children: const []);
      final j = page.joiner;
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: j, title: row.title, line: 'With ${j.name}', pill: row.done ? 'Done' : null),
          TeamSectionTitle('Agenda', meta: '${_agenda.length} things to talk about'),
          for (final (i, point) in _agenda.indexed)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 24,
                        height: 24,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(color: TeamColors.blueBg, shape: BoxShape.circle),
                        child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.primary)),
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: Text(point, style: const TextStyle(fontSize: 14, height: 1.4, fontWeight: FontWeight.w600, color: TeamColors.ink))),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TeamNotesField(field: 'agenda-$i', controller: _notes[i], voice: _voice, label: 'Your notes on $point'),
                ],
              ),
            ),
          SizedBox(
            height: 52,
            child: row.done
                ? OutlinedButton(
                    key: const ValueKey('team-meeting-done'),
                    style: OutlinedButton.styleFrom(
                      backgroundColor: OnbColors.successTint,
                      foregroundColor: OnbColors.successText,
                      side: const BorderSide(color: OnbColors.successLine),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    onPressed: _c.busy.contains(row.id) ? null : () => _toggle(row),
                    child: const Text('Done'),
                  )
                : FilledButton(
                    key: const ValueKey('team-meeting-mark'),
                    style: FilledButton.styleFrom(
                      backgroundColor: OnbColors.primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    onPressed: _c.busy.contains(row.id) || row.locked ? null : () => _toggle(row),
                    child: const Text('Mark as done'),
                  ),
          ),
          TeamFootnote('Only you can see your notes. ${j.first} keeps their own.'),
        ],
      );
    },
  );
}

// ─── A check-in to read ─────────────────────────────────────────────────────

/// MgrReview: "Rahul’s Month 1 check-in", when it was sent, every answer, Mark as read.
class TeamCheckinScreen extends StatefulWidget {
  const TeamCheckinScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  @override
  State<TeamCheckinScreen> createState() => _TeamCheckinScreenState();
}

class _TeamCheckinScreenState extends State<TeamCheckinScreen> {
  TeamCheckin? _checkin;
  Object? _error;
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final c = await _c.api.checkin(_c.journeyId, widget.row.checkinId ?? '');
      if (mounted) setState(() => _checkin = c);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _read() async {
    setState(() => _busy = true);
    try {
      await _c.api.markCheckinRead(_c.journeyId, widget.row.checkinId ?? '');
      unawaited(_c.load());
      if (mounted) _finish(context, 'Marked as read');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  static String _answer(TeamCheckinAnswer a) => switch (a.value) {
    final num n when a.type == 'rating' => '${n.toInt()} of 5',
    'yes' => 'Yes',
    'no' => 'No',
    final Object v => '$v',
    null => '',
  };

  @override
  Widget build(BuildContext context) {
    final page = _c.page;
    final c = _checkin;
    if (page == null || c == null) {
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load)],
      );
    }
    final j = page.joiner;
    final title = widget.row.title.replaceFirst(RegExp(r'^Read '), '');
    final (pill, bg, fg) = switch (c.state) {
      'read' => ('Read', TeamColors.okBg, TeamColors.okFg),
      'ready' => ('Ready to read', TeamColors.blueBg, OnbColors.primary),
      _ => ('Waiting', OnbColors.screen, OnbColors.text3),
    };
    final answered = c.answers.where((a) => a.value != null && '${a.value}'.isNotEmpty).toList();
    return _TaskFrame(
      controller: _c,
      title: widget.title,
      children: [
        TeamTaskHeader(
          joiner: j,
          title: title.isEmpty ? title : title[0].toUpperCase() + title.substring(1),
          line: c.sentAt == null ? '' : 'Sent ${teamAgo(c.sentAt!, _c.shell.now())}',
          pill: pill,
          pillBg: bg,
          pillFg: fg,
        ),
        for (final a in answered)
          TeamCard(
            padding: const EdgeInsets.all(14),
            children: [
              Text(a.question, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
              const SizedBox(height: 6),
              Text(_answer(a), style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
            ],
          ),
        if (c.state == 'ready') TeamPrimaryButton('Mark as read', busy: _busy, onTap: _read),
      ],
    );
  }
}

// ─── The head of department's approval ─────────────────────────────────────

/// HodApprove: "Dev’s confirmation", who recommended it and when, the three
/// answers, the recommendation and its note, the facts, your comments, and
/// Approve or Extend (by 1, 2 or 3 months).
class TeamApprovalScreen extends StatefulWidget {
  const TeamApprovalScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  @override
  State<TeamApprovalScreen> createState() => _TeamApprovalScreenState();
}

class _TeamApprovalScreenState extends State<TeamApprovalScreen> {
  final _voice = TeamVoice();
  final _comment = TextEditingController();
  TeamConfirmation? _view;
  Object? _error;
  bool _extend = false;
  String _months = '3 months';
  bool _busy = false;

  TeamPageController get _c => widget.controller;

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
    try {
      final v = await _c.api.confirmation(_c.journeyId);
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
    setState(() => _busy = true);
    try {
      await _c.api.answerConfirmation(_c.journeyId, action, extendMonths: action == 'extend' ? months : null, comment: _comment.text);
      unawaited(_c.load());
      if (mounted) _finish(context, action == 'approve' ? 'Confirmation approved' : 'Probation extended by $_months');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  static String _first(String name) => name.trim().split(RegExp(r'\s+')).first;

  @override
  Widget build(BuildContext context) {
    final page = _c.page;
    final v = _view;
    if (page == null || v == null) {
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load)],
      );
    }
    final j = page.joiner;
    final rec = v.recommendation;
    final by = rec?.byName ?? '';
    final (pill, bg, fg) = switch (v.state) {
      'approved' => ('Approved', TeamColors.okBg, TeamColors.okFg),
      'extended' => ('Extended', TeamColors.warnBg, TeamColors.warnFg),
      'ready' => ('Ready to approve', TeamColors.blueBg, OnbColors.primary),
      _ => ('Waiting', OnbColors.screen, OnbColors.text3),
    };
    final recT = rec == null
        ? ''
        : rec.outcome == 'extend'
        ? 'Extend by ${rec.extendMonths ?? 3} month${rec.extendMonths == 1 ? '' : 's'}'
        : 'Confirm';
    final ready = v.state == 'ready';
    return _TaskFrame(
      controller: _c,
      title: widget.title,
      children: [
        TeamTaskHeader(
          joiner: j,
          title: '${teamPossessive(j.first)} confirmation',
          line: rec?.at == null ? '' : 'Recommended ${teamAgo(rec!.at!, _c.shell.now())} by ${_first(by)}',
          pill: pill,
          pillBg: bg,
          pillFg: fg,
        ),
        if (rec != null)
          for (final (q, a) in [
            ('How they did against their KPIs and goals', rec.kpis),
            ('What they do well', rec.strengths),
            ('What to work on next', rec.next),
          ])
            if (a.isNotEmpty)
              TeamCard(
                padding: const EdgeInsets.all(14),
                children: [
                  Text(q, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
                  const SizedBox(height: 6),
                  Text(a, style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
                ],
              ),
        if (rec != null)
          Container(
            key: const ValueKey('team-recommends'),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: TeamColors.okBg, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$by recommends: $recT', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: TeamColors.okFg)),
                if (rec.note != null) ...[
                  const SizedBox(height: 6),
                  Text(rec.note!, style: const TextStyle(fontSize: 14, height: 1.5, color: TeamColors.ink)),
                ],
              ],
            ),
          ),
        if (v.facts.isNotEmpty)
          TeamCard(
            children: [
              for (final f in v.facts)
                Container(
                  constraints: const BoxConstraints(minHeight: 48),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: OnbColors.line))),
                  child: Row(
                    children: [
                      Expanded(child: Text(f.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink))),
                      const SizedBox(width: 10),
                      Text(f.value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: TeamColors.okFg)),
                    ],
                  ),
                ),
            ],
          ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const TeamLabel('Your comments'),
            const SizedBox(height: 8),
            TeamNotesField(field: 'approval', controller: _comment, voice: _voice, label: 'Your comments', hint: 'What you’d like ${j.first} to know', filled: false, minLines: 3),
            const SizedBox(height: 8),
            Text('${_first(by)}, ${j.first} and HR see your comments.', style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
          ],
        ),
        if (ready && _extend)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const TeamLabel('Extend probation by'),
              const SizedBox(height: 8),
              TeamChoices(options: const ['1 month', '2 months', '3 months'], selected: _months, onSelect: (m) => setState(() => _months = m)),
            ],
          ),
        if (ready)
          Row(
            children: [
              Expanded(
                flex: 10,
                child: TeamSecondaryButton(
                  _extend ? 'Cancel' : 'Extend',
                  onTap: _busy ? null : () => setState(() => _extend = !_extend),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 14,
                child: TeamPrimaryButton(
                  _extend ? 'Extend by $_months' : 'Approve',
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

// ─── Plain, the office round, groups ────────────────────────────────────────

/// A task with HR's how-to line and one button (Set KPIs, Add to the groups, a custom row).
class TeamPlainScreen extends StatefulWidget {
  const TeamPlainScreen({super.key, required this.controller, required this.row, required this.title, required this.button, required this.toast});

  final TeamPageController controller;
  final TeamTask row;
  final String title;
  final String button;
  final String toast;

  @override
  State<TeamPlainScreen> createState() => _TeamPlainScreenState();
}

class _TeamPlainScreenState extends State<TeamPlainScreen> {
  bool _busy = false;

  Future<void> _done() async {
    setState(() => _busy = true);
    try {
      await widget.controller.tick(_fresh(widget.controller, widget.row), done: true);
      if (mounted) _finish(context, widget.toast);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final page = widget.controller.page;
      final row = _fresh(widget.controller, widget.row);
      if (page == null) return _TaskFrame(controller: widget.controller, title: widget.title, children: const []);
      return _TaskFrame(
        controller: widget.controller,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: page.joiner, title: row.title, line: 'For ${page.joiner.name}', pill: row.done ? 'Done' : null),
          if (row.how != null) TeamHowBox(row.how!),
          if (!row.done && !row.locked) TeamPrimaryButton(widget.button, busy: _busy, onTap: _done),
        ],
      );
    },
  );
}

/// BuddyAround: the office round as a checklist (the app's copy), then Done.
class TeamAroundScreen extends StatefulWidget {
  const TeamAroundScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  static const places = [
    'Their desk and the team area',
    'Pantry and where people eat',
    'Meeting rooms',
    'Washrooms',
    'Fire exits and first aid',
    'The HR and IT desks',
  ];

  @override
  State<TeamAroundScreen> createState() => _TeamAroundScreenState();
}

class _TeamAroundScreenState extends State<TeamAroundScreen> {
  late final List<bool> _on = List.filled(TeamAroundScreen.places.length, widget.row.done);
  bool _busy = false;

  Future<void> _done() async {
    setState(() => _busy = true);
    try {
      await widget.controller.tick(_fresh(widget.controller, widget.row), done: true);
      if (mounted) _finish(context, 'Marked as done');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final page = widget.controller.page;
      final row = _fresh(widget.controller, widget.row);
      if (page == null) return _TaskFrame(controller: widget.controller, title: widget.title, children: const []);
      return _TaskFrame(
        controller: widget.controller,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: page.joiner, title: row.title, line: 'For ${page.joiner.name}', pill: row.done ? 'Done' : null),
          if (row.how != null) TeamHowBox(row.how!),
          TeamCard(
            children: [
              for (final (i, t) in TeamAroundScreen.places.indexed)
                Semantics(
                  checked: _on[i],
                  label: t,
                  excludeSemantics: true,
                  child: InkWell(
                    key: ValueKey('team-check-$i'),
                    onTap: () => setState(() => _on[i] = !_on[i]),
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 54),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: OnbColors.line))),
                      child: Row(
                        children: [
                          Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              color: _on[i] ? TeamColors.tickGreen : Colors.white,
                              borderRadius: BorderRadius.circular(7),
                              border: _on[i] ? null : Border.all(color: OnbColors.lineDark, width: 2),
                            ),
                            child: _on[i] ? const Icon(Icons.check_rounded, size: 14, color: Colors.white) : null,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(t, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _on[i] ? OnbColors.text3 : TeamColors.ink)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (!row.done && !row.locked) TeamPrimaryButton('Done', busy: _busy, onTap: _done),
        ],
      );
    },
  );
}

// ─── Assign a buddy ─────────────────────────────────────────────────────────

/// MgrAssignBuddy: colleagues to pick from (name, designation), the current
/// buddy picked, Assign (Save once there is one).
class TeamAssignBuddyScreen extends StatefulWidget {
  const TeamAssignBuddyScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  @override
  State<TeamAssignBuddyScreen> createState() => _TeamAssignBuddyScreenState();
}

class _TeamAssignBuddyScreenState extends State<TeamAssignBuddyScreen> {
  List<TeamBuddyOption>? _options;
  String? _pick;
  Object? _error;
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final r = await _c.api.buddyOptions(_c.journeyId);
      if (mounted) {
        setState(() {
          _options = r.options;
          _pick = r.current;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _assign() async {
    final pick = _options?.where((o) => o.userId == _pick).firstOrNull;
    final page = _c.page;
    if (pick == null || page == null) {
      showTeamToast(context, 'Pick someone first');
      return;
    }
    setState(() => _busy = true);
    try {
      _c.replace(await _c.api.assignBuddy(_c.journeyId, pick.userId));
      if (mounted) _finish(context, '${pick.name.split(' ').first} is ${teamPossessive(page.joiner.first)} buddy');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _c.page;
    final options = _options;
    if (page == null || options == null) {
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load)],
      );
    }
    final row = _fresh(_c, widget.row);
    return _TaskFrame(
      controller: _c,
      title: widget.title,
      children: [
        TeamTaskHeader(joiner: page.joiner, title: row.title, line: 'For ${page.joiner.name}'),
        if (row.how != null) TeamHowBox(row.how!),
        if (options.isNotEmpty)
          TeamCard(
            children: [
              for (final (i, o) in options.indexed)
                Semantics(
                  selected: o.userId == _pick,
                  button: true,
                  label: o.name,
                  excludeSemantics: true,
                  child: Material(
                    color: o.userId == _pick ? TeamColors.viewAllBg : Colors.white,
                    child: InkWell(
                      key: ValueKey('team-buddy-${o.userId}'),
                      onTap: () => setState(() => _pick = o.userId),
                      child: Container(
                        constraints: const BoxConstraints(minHeight: 64),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: OnbColors.line))),
                        child: Row(
                          children: [
                            OnbAvatar(name: o.name, photoUrl: o.photoUrl, size: 40),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(o.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                                  if (o.designation != null) ...[
                                    const SizedBox(height: 2),
                                    Text(o.designation!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                                  ],
                                ],
                              ),
                            ),
                            Container(
                              width: 22,
                              height: 22,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.white,
                                border: Border.all(color: o.userId == _pick ? OnbColors.primary : OnbColors.lineDark, width: o.userId == _pick ? 7 : 2),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        TeamPrimaryButton(row.done ? 'Save' : 'Assign', busy: _busy, onTap: _assign),
      ],
    );
  }
}

// ─── Schedule the first-week meetings ───────────────────────────────────────

/// MgrSchedule: the Day 1 and Week 1 meetings (already made from the
/// template), "n of 3 set", a time for each, Send invites.
class TeamScheduleScreen extends StatefulWidget {
  const TeamScheduleScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  @override
  State<TeamScheduleScreen> createState() => _TeamScheduleScreenState();
}

class _TeamScheduleScreenState extends State<TeamScheduleScreen> {
  final Map<String, DateTime> _times = {};
  final Set<int> _open = {};
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    for (final m in _c.page?.schedule ?? const <TeamScheduleMeeting>[]) {
      if (m.startsAt != null) _times[m.rowKey] = m.startsAt!;
    }
  }

  DateTime get _tj {
    final tj = DateTime.tryParse(_c.page?.joiner.tj ?? '');
    final now = _c.shell.now();
    return tj ?? DateTime(now.year, now.month, now.day);
  }

  Future<void> _pick(TeamScheduleMeeting m) async {
    final tj = _tj;
    var day = tj;
    if (m.step == 2) {
      final first = tj.add(const Duration(days: 1));
      final last = tj.add(const Duration(days: 6));
      final current = _times[m.rowKey];
      final chosen = await showDatePicker(
        context: context,
        firstDate: first,
        lastDate: last,
        initialDate: current != null && !current.isBefore(first) && !current.isAfter(last) ? current : first,
      );
      if (chosen == null || !mounted) return;
      day = chosen;
    }
    final at = _times[m.rowKey];
    final time = await showTimePicker(context: context, initialTime: at == null ? const TimeOfDay(hour: 11, minute: 0) : TimeOfDay.fromDateTime(at));
    if (time == null || !mounted) return;
    setState(() => _times[m.rowKey] = DateTime(day.year, day.month, day.day, time.hour, time.minute));
  }

  Future<void> _send() async {
    final set = Map.of(_times);
    setState(() => _busy = true);
    try {
      _c.replace(await _c.api.schedule(_c.journeyId, set));
      if (mounted) _finish(context, set.isEmpty ? 'Invites sent' : 'Invites sent for ${set.length} meeting${set.length > 1 ? 's' : ''}');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      if (page == null) return _TaskFrame(controller: _c, title: widget.title, children: const []);
      final row = _fresh(_c, widget.row);
      final groups = [
        for (final (step, label) in [(1, 'Day 1'), (2, 'Week 1')]) (step, label, page.schedule.where((m) => m.step == step).toList()),
      ].where((g) => g.$3.isNotEmpty).toList();
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: page.joiner, title: row.title, line: 'For ${page.joiner.name}', pill: row.done ? 'Done' : null),
          if (row.how != null) TeamHowBox(row.how!),
          if (groups.isNotEmpty)
            TeamCard(
              children: [
                for (final (gi, (step, label, rows)) in groups.indexed) ...[
                  InkWell(
                    key: ValueKey('team-sched-group-$step'),
                    onTap: () => setState(() => _open.contains(step) ? _open.remove(step) : _open.add(step)),
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 56),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(border: gi == 0 ? null : const Border(top: BorderSide(color: OnbColors.line))),
                      child: Row(
                        children: [
                          Expanded(child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink))),
                          Text(
                            '${rows.where((m) => _times.containsKey(m.rowKey)).length} of ${rows.length} set',
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3),
                          ),
                          const SizedBox(width: 10),
                          Container(
                            width: 26,
                            height: 26,
                            decoration: const BoxDecoration(color: OnbColors.screen, shape: BoxShape.circle),
                            child: Icon(_open.contains(step) ? Icons.remove_rounded : Icons.add_rounded, size: 16, color: TeamColors.ink),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_open.contains(step))
                    for (final m in rows)
                      Container(
                        constraints: const BoxConstraints(minHeight: 60),
                        padding: const EdgeInsets.fromLTRB(16, 8, 14, 8),
                        decoration: const BoxDecoration(color: Color(0xFFFCFCFD), border: Border(top: BorderSide(color: OnbColors.line))),
                        child: Row(
                          children: [
                            OnbAvatar(name: m.withName ?? m.title, size: 30),
                            const SizedBox(width: 10),
                            Expanded(child: Text(m.title, style: const TextStyle(fontSize: 13, height: 1.3, fontWeight: FontWeight.w600, color: TeamColors.ink))),
                            const SizedBox(width: 10),
                            _TimeField(
                              key: ValueKey('team-sched-${m.rowKey}'),
                              label: 'Time for ${m.title}',
                              value: _times[m.rowKey] == null ? null : (m.step == 1 ? teamClock(_times[m.rowKey]!) : teamDayClock(_times[m.rowKey]!)),
                              onTap: () => _pick(m),
                            ),
                          ],
                        ),
                      ),
                ],
              ],
            ),
          if (!row.done) TeamPrimaryButton('Send invites', busy: _busy, onTap: _send),
        ],
      );
    },
  );
}

/// The canvas's select: "Pick a time" until one is chosen, then the time in blue.
class _TimeField extends StatelessWidget {
  const _TimeField({super.key, required this.label, required this.value, required this.onTap});

  final String label;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    value: value,
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 38,
        constraints: const BoxConstraints(maxWidth: 128),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: value == null ? Border.all(color: OnbColors.lineDark) : Border.all(color: OnbColors.primary, width: 1.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                value ?? 'Pick a time',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: value == null ? OnbColors.text3 : OnbColors.primary),
              ),
            ),
            const SizedBox(width: 2),
            Icon(Icons.expand_more_rounded, size: 18, color: value == null ? OnbColors.text3 : OnbColors.primary),
          ],
        ),
      ),
    ),
  );
}

// ─── A welcome message, a post on the feed ──────────────────────────────────

/// MgrWelcome ([post] false): the message, prefilled with their first name,
/// the joining date and your first meeting's time; Send.
/// MgrFeed ([post] true): you, "Posting to everyone", the post prefilled
/// with their name, designation and department, the welcome card; Post.
class TeamMessageScreen extends StatefulWidget {
  const TeamMessageScreen({super.key, required this.controller, required this.row, required this.title, required this.post});

  final TeamPageController controller;
  final TeamTask row;
  final String title;
  final bool post;

  /// The canvas's prefilled words, from the page.
  static String draft(TeamJoinerPage page, {required bool post, required String viewerFirst}) {
    final j = page.joiner;
    if (post) {
      final role = j.designation == null ? '' : ' as ${j.designation!.toLowerCase()}';
      final team = j.department == null ? '' : ' in the ${j.department} team';
      return 'Please welcome ${j.name}, who joins us$role$team. Say hi when you see ${j.first} around the office!';
    }
    final on = j.tj == null ? '' : ' on ${teamDayMonth(j.tj!)}';
    final day1 = page.tasks.where((t) => t.isMeeting && t.step == 1).firstOrNull;
    final at = day1?.startsAt ?? page.schedule.where((m) => m.rowKey == day1?.id).firstOrNull?.startsAt;
    final meet = at == null ? 'I’ll meet you on your first day' : 'I’ll meet you at ${teamClock(at)} on your first day';
    return 'Hi ${j.first}, we’re so glad you’re joining us$on. $meet to talk through your first week. See you soon! $viewerFirst'.trim();
  }

  @override
  State<TeamMessageScreen> createState() => _TeamMessageScreenState();
}

class _TeamMessageScreenState extends State<TeamMessageScreen> {
  late final TextEditingController _text;
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    final page = _c.page;
    _text = TextEditingController(text: page == null ? '' : TeamMessageScreen.draft(page, post: widget.post, viewerFirst: _c.shell.viewerFirstName));
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final page = _c.page;
    if (page == null) return;
    setState(() => _busy = true);
    try {
      _c.replace(widget.post ? await _c.api.feedPost(_c.journeyId, _text.text.trim()) : await _c.api.welcomeMessage(_c.journeyId, _text.text.trim()));
      if (mounted) _finish(context, widget.post ? 'Posted on the feed' : 'Message sent to ${page.joiner.first}');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      if (page == null) return _TaskFrame(controller: _c, title: widget.title, children: const []);
      final row = _fresh(_c, widget.row);
      final j = page.joiner;
      final shell = _c.shell;
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: j, title: row.title, line: 'For ${j.name}', pill: row.done ? 'Done' : null),
          if (row.how != null) TeamHowBox(row.how!),
          TeamCard(
            padding: const EdgeInsets.all(14),
            children: [
              if (widget.post) ...[
                Row(
                  children: [
                    OnbAvatar(name: shell.viewerName, photoUrl: shell.viewerPhotoUrl, size: 36),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(shell.viewerName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                        const Text('Posting to everyone', style: TextStyle(fontSize: 12, color: OnbColors.text3)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              TeamTextBox(controller: _text, minLines: 5, label: widget.post ? 'Your post' : 'Your message'),
              if (widget.post) ...[
                const SizedBox(height: 12),
                Container(
                  height: 150,
                  decoration: BoxDecoration(color: TeamColors.blueBg, borderRadius: BorderRadius.circular(14)),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      OnbAvatar(name: j.name, photoUrl: j.photoUrl, size: 64),
                      const SizedBox(height: 8),
                      Text('Welcome, ${j.first}!', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: OnbColors.primary)),
                    ],
                  ),
                ),
              ],
            ],
          ),
          if (!row.done) TeamPrimaryButton(widget.post ? 'Post' : 'Send', busy: _busy, onTap: _send),
        ],
      );
    },
  );
}

// ─── Comment on goals ───────────────────────────────────────────────────────

/// MgrGoals: after the Monthly goals talk, each goal with how it is going and
/// the joiner's note, a comment each; Send to Rahul.
class TeamGoalsScreen extends StatefulWidget {
  const TeamGoalsScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  static const statusLabels = {'start': 'Just started', 'progress': 'Making progress', 'well': 'Going well'};

  @override
  State<TeamGoalsScreen> createState() => _TeamGoalsScreenState();
}

class _TeamGoalsScreenState extends State<TeamGoalsScreen> {
  List<TeamGoal>? _goals;
  final Map<int, TextEditingController> _comments = {};
  Object? _error;
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in _comments.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final goals = await _c.api.goals(_c.journeyId, widget.row.month ?? 1);
      if (!mounted) return;
      setState(() {
        _goals = goals;
        for (final g in goals) {
          _comments.putIfAbsent(g.index, () => TextEditingController(text: g.comment ?? ''));
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final page = _c.page;
    if (page == null) return;
    setState(() => _busy = true);
    try {
      await _c.api.commentOnGoals(_c.journeyId, widget.row.month ?? 1, {for (final e in _comments.entries) e.key: e.value.text.trim()});
      unawaited(_c.load());
      if (mounted) _finish(context, 'Comments sent to ${page.joiner.first}');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _c.page;
    final goals = _goals;
    if (page == null || goals == null) {
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load)],
      );
    }
    final row = _fresh(_c, widget.row);
    final j = page.joiner;
    return _TaskFrame(
      controller: _c,
      title: widget.title,
      children: [
        TeamTaskHeader(joiner: j, title: row.title, line: 'After your Monthly goals talk', pill: row.done ? 'Done' : null),
        if (row.how != null) TeamHowBox(row.how!),
        for (final g in goals)
          TeamCard(
            padding: const EdgeInsets.all(14),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text(g.text, style: const TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w700, color: TeamColors.ink))),
                  if (TeamGoalsScreen.statusLabels[g.status] != null) ...[
                    const SizedBox(width: 10),
                    TeamPill(TeamGoalsScreen.statusLabels[g.status]!, background: TeamColors.blueBg, foreground: OnbColors.primary, height: 22),
                  ],
                ],
              ),
              if (g.note != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: OnbColors.screen, borderRadius: BorderRadius.circular(12)),
                  child: Text('${j.first}: ${g.note}', style: const TextStyle(fontSize: 13, height: 1.5, color: OnbColors.text2)),
                ),
              ],
              const SizedBox(height: 10),
              TeamTextBox(controller: _comments[g.index]!, hint: 'Your comment', minLines: 2, label: 'Your comment on ${g.text}'),
            ],
          ),
        if (!row.done) TeamPrimaryButton('Send to ${j.first}', busy: _busy, onTap: _send),
      ],
    );
  }
}

// ─── The confirmation review ────────────────────────────────────────────────

/// MgrConfReview: their probation (the facts, for your review), your
/// recommendation (Confirm / Extend by 1–3 months), three answers, Send to
/// the head of department.
class TeamConfReviewScreen extends StatefulWidget {
  const TeamConfReviewScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  static const fields = [
    ('How they did against their KPIs and goals', 'Where they met them, and where not yet'),
    ('What they do well', 'What you’d want them to keep doing'),
    ('What to work on next', 'One or two things for the next six months'),
  ];

  @override
  State<TeamConfReviewScreen> createState() => _TeamConfReviewScreenState();
}

class _TeamConfReviewScreenState extends State<TeamConfReviewScreen> {
  TeamReviewView? _view;
  Object? _error;
  String _outcome = 'confirm';
  String _months = '3 months';
  final _answers = [TextEditingController(), TextEditingController(), TextEditingController()];
  bool _busy = false;

  TeamPageController get _c => widget.controller;

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
    try {
      final v = await _c.api.review(_c.journeyId);
      if (mounted) setState(() => _view = v);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final v = _view;
    if (v == null) return;
    setState(() => _busy = true);
    try {
      _c.replace(
        await _c.api.sendReview(
          _c.journeyId,
          outcome: _outcome,
          extendMonths: _outcome == 'extend' ? int.parse(_months.split(' ').first) : null,
          kpis: _answers[0].text.trim(),
          strengths: _answers[1].text.trim(),
          next: _answers[2].text.trim(),
        ),
      );
      if (mounted) _finish(context, v.approverName == null ? 'Sent to approve' : 'Sent to ${v.approverName!.split(' ').first} to approve');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _c.page;
    final v = _view;
    if (page == null || v == null) {
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [OnbLoadState(error: _error == null ? null : onboardingErrorText(_error!), onRetry: _load)],
      );
    }
    final row = _fresh(_c, widget.row);
    final sent = row.done || v.sent != null;
    final j = page.joiner;
    return _TaskFrame(
      controller: _c,
      title: widget.title,
      children: [
        TeamTaskHeader(joiner: j, title: row.title, line: 'For ${j.name}', pill: sent ? 'Done' : null),
        if (row.how != null) TeamHowBox(row.how!),
        if (v.facts.isNotEmpty) ...[
          const _BlockLabel('Their probation', meta: 'For your review'),
          TeamCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            children: [
              for (final (i, f) in v.facts.indexed)
                Container(
                  constraints: const BoxConstraints(minHeight: 46),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: OnbColors.line))),
                  child: Row(
                    children: [
                      Text(f.label, style: const TextStyle(fontSize: 14, height: 20 / 14, color: Color(0xFF6B7080))),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Text(f.value, textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: Color(0xFF16181D))),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
        if (!sent) ...[
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const TeamLabel('Your recommendation'),
              const SizedBox(height: 8),
              TeamSegmented(options: const [('confirm', 'Confirm'), ('extend', 'Extend')], selected: _outcome, onSelect: (o) => setState(() => _outcome = o)),
            ],
          ),
          if (_outcome == 'extend')
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const TeamLabel('Extend by'),
                const SizedBox(height: 8),
                TeamChoices(options: const ['1 month', '2 months', '3 months'], selected: _months, onSelect: (m) => setState(() => _months = m)),
              ],
            ),
          for (final (i, (t, ph)) in TeamConfReviewScreen.fields.indexed)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TeamLabel(t),
                const SizedBox(height: 8),
                TeamTextBox(key: ValueKey('team-field-$i'), controller: _answers[i], hint: ph, minLines: 3, label: t),
              ],
            ),
          TeamPrimaryButton(v.approverName == null ? 'Send' : 'Send to ${v.approverName!.split(' ').first}', busy: _busy, onTap: _send),
        ],
      ],
    );
  }
}

/// A grey upper-case label over a block, with its meta on the right.
class _BlockLabel extends StatelessWidget {
  const _BlockLabel(this.text, {this.meta});

  final String text;
  final String? meta;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 8, 2, 0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Expanded(child: Text(text.toUpperCase(), style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: Color(0xFF6B7080)))),
        if (meta != null) Text(meta!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF6B7080))),
      ],
    ),
  );
}

// ─── Meet the new joiners ───────────────────────────────────────────────────

/// HodMeet: one to one, or with the other new joiners this week (yours, at
/// Day 1 or Week 1), a time, Send invite.
class TeamInviteScreen extends StatefulWidget {
  const TeamInviteScreen({super.key, required this.controller, required this.row, required this.title});

  final TeamPageController controller;
  final TeamTask row;
  final String title;

  @override
  State<TeamInviteScreen> createState() => _TeamInviteScreenState();
}

class _TeamInviteScreenState extends State<TeamInviteScreen> {
  String _mode = 'group';
  List<TeamJoinerRow> _week = const [];
  DateTime? _at;
  bool _busy = false;

  TeamPageController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final all = await _c.api.fetchJoiners();
      if (mounted) setState(() => _week = all.where((x) => x.step >= 1 && x.step <= 2).toList());
    } catch (_) {}
  }

  Future<void> _pickTime() async {
    final now = _c.shell.now();
    final day = await showDatePicker(context: context, firstDate: DateTime(now.year, now.month, now.day), lastDate: now.add(const Duration(days: 30)), initialDate: _at ?? now);
    if (day == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: _at == null ? const TimeOfDay(hour: 11, minute: 0) : TimeOfDay.fromDateTime(_at!));
    if (time == null || !mounted) return;
    setState(() => _at = DateTime(day.year, day.month, day.day, time.hour, time.minute));
  }

  Future<void> _send() async {
    final page = _c.page;
    final at = _at;
    if (page == null) return;
    if (at == null) {
      showTeamToast(context, 'Pick a time');
      return;
    }
    final group = _mode == 'group';
    final others = [for (final x in _week) if (x.journeyId != _c.journeyId) x.journeyId];
    setState(() => _busy = true);
    try {
      _c.replace(await _c.api.seniorMeeting(_c.journeyId, mode: _mode, startsAt: at, journeyIds: group ? others : const []));
      final n = others.length + 1;
      if (mounted) _finish(context, group ? 'Invite sent to $n new joiners' : 'Invite sent to ${page.joiner.first}');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showTeamToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      if (page == null) return _TaskFrame(controller: _c, title: widget.title, children: const []);
      final row = _fresh(_c, widget.row);
      return _TaskFrame(
        controller: _c,
        title: widget.title,
        children: [
          TeamTaskHeader(joiner: page.joiner, title: row.title, line: 'For ${page.joiner.name}', pill: row.done ? 'Done' : null),
          if (row.how != null) TeamHowBox(row.how!),
          TeamSegmented(options: const [('one', 'One to one'), ('group', 'With other new joiners')], selected: _mode, onSelect: (m) => setState(() => _mode = m)),
          if (_mode == 'group' && _week.isNotEmpty)
            TeamCard(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(14, 12, 14, 6),
                  child: Text('New joiners this week', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.text3)),
                ),
                for (final x in _week)
                  Container(
                    constraints: const BoxConstraints(minHeight: 52),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: const BoxDecoration(border: Border(top: BorderSide(color: OnbColors.line))),
                    child: Row(
                      children: [
                        OnbAvatar(name: x.name, photoUrl: x.photoUrl, size: 32),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(x.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
                              if (x.designation != null) Text(x.designation!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TeamLabel('Pick a time', small: true),
              const SizedBox(height: 8),
              _TimeField(
                key: const ValueKey('team-invite-time'),
                label: 'Pick a time',
                value: _at == null ? null : teamDayClock(_at!),
                onTap: _pickTime,
              ),
            ],
          ),
          if (!row.done) TeamPrimaryButton('Send invite', busy: _busy, onTap: _send),
        ],
      );
    },
  );
}
