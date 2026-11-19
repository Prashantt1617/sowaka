import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../links.dart';
import '../onboarding_kit.dart';
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
/// box with voice typing under each point, and Mark as done. The notes are
/// the manager's own (a private 1:1 note); the joiner keeps theirs.
class TeamMeetingScreen extends StatefulWidget {
  const TeamMeetingScreen({super.key, required this.shell, required this.journeyId, required this.task, required this.joiner});

  final OnboardingShell shell;
  final String journeyId;
  final TaskView task;
  final JoinerSummary joiner;

  @override
  State<TeamMeetingScreen> createState() => _TeamMeetingScreenState();
}

class _TeamMeetingScreenState extends State<TeamMeetingScreen> {
  final _voice = TeamVoice();
  late final List<String> _agenda = () {
    final sent = widget.task.meeting?.expect ?? const <String>[];
    return sent.isNotEmpty ? sent : defaultMeetingAgenda(widget.task, widget.joiner.firstName);
  }();
  late final List<TextEditingController> _notes = [for (final _ in _agenda) TextEditingController()];
  late bool _done = widget.task.isDone;
  bool _busy = false;

  @override
  void dispose() {
    _voice.dispose();
    for (final c in _notes) {
      c.dispose();
    }
    super.dispose();
  }

  /// The points with something written, as one private note.
  String get _noteText => [
    for (final (i, c) in _notes.indexed)
      if (c.text.trim().isNotEmpty) '${_agenda[i]}: ${c.text.trim()}',
  ].join('\n');

  Future<void> _finish() async {
    setState(() => _busy = true);
    final api = widget.shell.api;
    try {
      final text = _noteText;
      if (text.isNotEmpty) {
        await api.addNote(widget.journeyId, '${widget.task.title}\n$text', shared: false);
        for (final c in _notes) {
          c.clear();
        }
      }
      if (!_done && managerMayTick(widget.task)) {
        await api.managerTaskDone(widget.journeyId, widget.task.id);
        _done = true;
      }
      if (mounted) showAppToast(context, _done ? 'Marked as done' : 'Notes saved');
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final joiner = widget.joiner;
    final task = widget.task;
    final link = task.meeting?.link;
    final start = task.startsAt;
    final canTick = !_done && managerMayTick(task);
    return OnbScaffold(
      shell: widget.shell,
      title: joiner.name,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Container(
            key: const ValueKey('meeting-head'),
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
                      Text(task.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                      const SizedBox(height: 2),
                      Text(
                        ['With ${joiner.name}', if (start != null) '${onbDay(start)}, ${onbTime(start)}'].join(' · '),
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
                    const SizedBox(height: 10),
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
                        : Text(canTick ? 'Mark as done' : 'Save notes'),
                  ),
          ),
          const SizedBox(height: 8),
          TeamFootnote('Only you can see your notes. ${joiner.firstName} keeps their own.'),
        ],
      ),
    );
  }
}
