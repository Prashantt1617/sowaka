import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../links.dart';
import '../onboarding_kit.dart';
import '../../onboarding_launcher.dart';
import 'team_kit.dart';

/// The agenda a meeting opens with when the journey sends none (the
/// artifact's agendas, by the kind of meeting).
List<String> defaultMeetingAgenda(TaskView task, String first) {
  final key = task.systemKey ?? task.meeting?.systemKey;
  switch (key) {
    case 'meet_manager':
      return ['How the first week will look', 'What a good first month looks like', 'How you’ll work together', 'Who to meet first'];
    case 'monthly_checkin':
      return ['Progress on this month’s goals', 'What’s going well', 'What’s hard', 'Goals for next month'];
    case 'confirmation_discussion':
      return ['Six months, looking back', 'Feedback both ways', 'Confirm or extend, and what’s next'];
    case 'buddy_checkin':
      return ['How $first is settling in', 'Anything $first is stuck on'];
    case 'week1_wrap':
      return ['Highlights of the week', 'Questions so far', 'Plan for next week'];
  }
  return ['How $first is settling in', 'Anything $first needs from you'];
}

/// A meeting with a joiner (MgrMeeting): who it is with, the agenda, a notes
/// box with voice typing under each point, and Mark as done. For the manager
/// the notes are kept as a private 1:1 note; the joiner keeps theirs.
/// [TeamMeetingScreen.forManager] reads a journey task; the buddy and head of
/// department pages build it from their own task ([onFinish] says what
/// finishing does there).
class TeamMeetingScreen extends StatefulWidget {
  const TeamMeetingScreen({
    super.key,
    this.shell,
    required this.title,
    required this.joinerName,
    this.joinerPhotoUrl,
    required this.agenda,
    this.link,
    this.startsAt,
    this.done = false,
    this.canTick = false,
    this.savesNotes = true,
    required this.onFinish,
  });

  /// The manager's meeting on a journey task.
  factory TeamMeetingScreen.forManager({Key? key, required OnboardingShell shell, required String journeyId, required TaskView task, required JoinerSummary joiner}) {
    final sent = task.meeting?.expect ?? const <String>[];
    return TeamMeetingScreen(
      key: key,
      shell: shell,
      title: task.title,
      joinerName: joiner.name,
      joinerPhotoUrl: joiner.photoUrl,
      agenda: sent.isNotEmpty ? sent : defaultMeetingAgenda(task, joiner.firstName),
      link: task.meeting?.link,
      startsAt: task.startsAt,
      done: task.isDone,
      canTick: managerMayTick(task),
      onFinish: (notes, markDone) async {
        if (notes.isNotEmpty) await shell.api.addNote(journeyId, '${task.title}\n$notes', shared: false);
        if (markDone) await shell.api.managerTaskDone(journeyId, task.id);
      },
    );
  }

  /// The app's header and tabs (the signed-in shell's when null).
  final OnboardingShell? shell;
  final String title;
  final String joinerName;
  final String? joinerPhotoUrl;
  final List<String> agenda;
  final String? link;
  final DateTime? startsAt;
  final bool done;

  /// Whether finishing marks it done (else it only saves the notes).
  final bool canTick;

  /// Whether there is somewhere to keep notes: without it the agenda shows
  /// without the notes boxes.
  final bool savesNotes;

  /// Saves [notes] (the points written on, one per line; empty when none)
  /// and, when [markDone], marks the meeting done. Throws to say it failed.
  final Future<void> Function(String notes, bool markDone) onFinish;

  @override
  State<TeamMeetingScreen> createState() => _TeamMeetingScreenState();
}

class _TeamMeetingScreenState extends State<TeamMeetingScreen> {
  final _voice = TeamVoice();
  late final List<String> _agenda = widget.agenda;
  late final List<TextEditingController> _notes = [for (final _ in _agenda) TextEditingController()];
  late bool _done = widget.done;
  bool _busy = false;

  @override
  void dispose() {
    _voice.dispose();
    for (final c in _notes) {
      c.dispose();
    }
    super.dispose();
  }

  /// The points with something written.
  String get _noteText => [
    for (final (i, c) in _notes.indexed)
      if (c.text.trim().isNotEmpty) '${_agenda[i]}: ${c.text.trim()}',
  ].join('\n');

  Future<void> _finish() async {
    setState(() => _busy = true);
    try {
      final text = _noteText;
      final markDone = !_done && widget.canTick;
      await widget.onFinish(text, markDone);
      for (final c in _notes) {
        c.clear();
      }
      if (markDone) _done = true;
      if (mounted) showAppToast(context, markDone ? 'Marked as done' : 'Notes saved');
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.joinerName;
    final first = name.trim().split(RegExp(r'\s+')).first;
    final link = widget.link;
    final start = widget.startsAt;
    final canTick = !_done && widget.canTick;
    final shell = widget.shell ?? currentOnboardingShell();
    final body = ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Container(
            key: const ValueKey('meeting-head'),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
            child: Row(
              children: [
                OnbAvatar(name: name, photoUrl: widget.joinerPhotoUrl, size: 52),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                      const SizedBox(height: 2),
                      Text(
                        ['With $name', if (start != null) '${onbDay(start)}, ${onbTime(start)}'].join(' · '),
                        style: const TextStyle(fontSize: 12, color: OnbColors.text3),
                      ),
                    ],
                  ),
                ),
                if (_done) const TeamPill('Done', background: TeamColors.okBg, foreground: Color(0xFF1F9D45), height: 26),
              ],
            ),
          ),
          if (link != null && !_done) ...[
            const SizedBox(height: 10),
            OnbSecondaryButton(label: 'Join the call', onTap: () => openExternalLink(context, link)),
          ],
          const SizedBox(height: 14),
          TeamSectionTitle('Agenda', meta: '${_agenda.length} things to talk about'),
          const SizedBox(height: 10),
          for (final (i, point) in _agenda.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Container(
                key: ValueKey('agenda-$i'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 26,
                          height: 26,
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(color: TeamColors.okBg, shape: BoxShape.circle),
                          child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: TeamColors.okFg)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: Text(point, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink))),
                      ],
                    ),
                    if (widget.savesNotes) const SizedBox(height: 10),
                    if (widget.savesNotes)
                    TeamNotesField(field: 'agenda-$i', controller: _notes[i], voice: _voice, label: 'Your notes on $point'),
                  ],
                ),
              ),
            ),
          SizedBox(
            height: 52,
            child: _done && !canTick
                ? OutlinedButton(
                    key: const ValueKey('meeting-done'),
                    onPressed: _busy ? null : _finish,
                    style: OutlinedButton.styleFrom(
                      backgroundColor: TeamColors.okBg,
                      foregroundColor: const Color(0xFF1F9D45),
                      side: const BorderSide(color: Color(0xFFCFE3D6)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('Done · save notes'),
                  )
                : FilledButton(
                    key: const ValueKey('meeting-mark-done'),
                    onPressed: _busy ? null : _finish,
                    style: FilledButton.styleFrom(
                      backgroundColor: OnbColors.primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    child: _busy
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(canTick || !widget.savesNotes ? 'Mark as done' : 'Save notes'),
                  ),
          ),
          const SizedBox(height: 8),
          if (widget.savesNotes) TeamFootnote('Only you can see your notes. $first keeps their own.'),
      ],
    );
    if (shell != null) return OnbScaffold(shell: shell, title: name, body: body);
    return Scaffold(backgroundColor: OnbColors.screen, appBar: AppBar(title: Text(name)), body: body);
  }
}
