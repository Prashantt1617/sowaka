import 'dart:async';

import 'package:flutter/material.dart';

import '../../../policies/presentation/policies_ack_screen.dart';
import '../../../profile/profile_launcher.dart';
import '../../../shared/app_toast.dart';
import '../data/joiner_meetings_api.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import '../onboarding_launcher.dart';
import '../timeline/lens_lists.dart';
import '../timeline/lens_selection.dart';
import '../timeline/stage_lens.dart';
import 'manager/team_kit.dart' show TeamNotesField, TeamVoice;
import 'onboarding_kit.dart';
import 'onboarding_tiles.dart' show policiesSourceFor;

/// The new-joiner prototype's Meetings, a meeting, Your team and Tasks
/// (Main.dc.html view=meetings / meet / tasks, TeamList.dc.html), read from
/// the onboarding home through the stage the home's timeline picked
/// ([onbLensSelection]): her own stage, a stage ahead, or one behind.

/// A whole-screen list read from the home (the device's copy first).
mixin _HomeList<T extends StatefulWidget> on State<T> {
  OnboardingHome? home;
  String? error;
  OnboardingShell get shell;

  void startLoading() => unawaited(_first());

  Future<void> _first() async {
    final kept = await shell.api.fromDevice((api) => api.fetchHome());
    if (kept != null && mounted && home == null) setState(() => home = kept);
    await load();
  }

  Future<void> load() async {
    try {
      final h = await shell.api.fetchHome();
      if (mounted) {
        setState(() {
          home = h;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = onboardingErrorText(e));
    }
  }

  /// The home through the lens the timeline holds.
  Widget lensed(Widget Function(OnboardingHome home, StageLens lens) build) {
    final h = home;
    if (h == null) return OnbLoadState(error: error, onRetry: load);
    return ValueListenableBuilder<int?>(
      valueListenable: onbLensSelection,
      builder: (context, at, _) => RefreshIndicator(onRefresh: load, child: build(h, StageLens.of(h, shell.now(), selected: at))),
    );
  }
}

// ─── Meetings ───────────────────────────────────────────────────────────────

/// "People to meet": who, with whom and how many things to discuss, a tick
/// for each one met (on the record the other side reads), what comes later
/// under COMING UP, locked ones with "Opens in Month 1"; Your team last, in
/// Day 1 and Week 1.
class OnbMeetingsScreen extends StatefulWidget {
  const OnbMeetingsScreen({super.key, required this.shell, this.source});

  final OnboardingShell shell;

  /// Supplied by tests; the server's otherwise.
  final JoinerMeetingsSource? source;

  @override
  State<OnbMeetingsScreen> createState() => _OnbMeetingsScreenState();
}

class _OnbMeetingsScreenState extends State<OnbMeetingsScreen> with _HomeList<OnbMeetingsScreen> {
  late final JoinerMeetingsSource? _source = widget.source ?? joinerMeetingsSourceFor(widget.shell.api);
  final Set<String> _busy = {};
  JoinerTeam? _team;

  @override
  OnboardingShell get shell => widget.shell;

  @override
  void initState() {
    super.initState();
    startLoading();
    unawaited(_loadTeam());
  }

  Future<void> _loadTeam() async {
    final source = _source;
    if (source == null) return;
    final kept = await source.keptTeam();
    if (kept != null && mounted && _team == null) setState(() => _team = kept);
    try {
      final team = await source.fetchTeam();
      if (mounted) setState(() => _team = team);
    } catch (_) {
      // The row waits for the next open.
    }
  }

  Future<void> _tick(TaskView t) async {
    final source = _source;
    if (source == null || _busy.contains(t.id)) return;
    setState(() => _busy.add(t.id));
    try {
      await source.markMet(t.id);
      await load();
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy.remove(t.id));
    }
  }

  Future<void> _open(TaskView t) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => JoinerMeetingScreen(shell: shell, task: t, source: _source)),
    );
    if (mounted) await load();
  }

  @override
  Widget build(BuildContext context) => OnbScaffold(
    shell: shell,
    title: 'Meetings',
    offline: home != null && error != null,
    body: lensed((home, lens) {
      final team = _team;
      // Your team: in her own stage, on Day 1 and in Week 1 (as drawn).
      final showTeam = lens.mode == LensMode.now && lens.current <= 1 && team != null && team.people.isNotEmpty;
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          LensSection(
            key: const ValueKey('meetings-list'),
            title: 'People to meet',
            meta: lens.meetingsMeta,
            items: lens.meetings,
            now: shell.now(),
            meetings: true,
            onOpen: _open,
            onTick: _source == null ? null : _tick,
            busy: _busy,
            footer: showTeam ? _TeamRow(team: team, onTap: () => _openTeam(team)) : null,
          ),
        ],
      );
    }),
  );

  Future<void> _openTeam(JoinerTeam team) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => TeamListScreen(shell: shell, source: _source, initial: team)),
    );
  }
}

/// The card's last row: three faces, "Your team", "Admissions · 6 people".
class _TeamRow extends StatelessWidget {
  const _TeamRow({required this.team, required this.onTap});

  final JoinerTeam team;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final count = '${team.people.length} ${team.people.length == 1 ? 'person' : 'people'}';
    return Semantics(
      button: true,
      label: 'Your team. ${team.department} · $count',
      child: InkWell(
        key: const ValueKey('your-team'),
        onTap: onTap,
        child: ExcludeSemantics(
          child: Container(
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                for (final (i, p) in team.people.take(3).indexed)
                  Align(
                    widthFactor: i == 2 || i == team.people.take(3).length - 1 ? 1 : 0.7,
                    child: Container(
                      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)),
                      child: OnbAvatar(name: p.name, photoUrl: p.photoUrl, size: 32),
                    ),
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Your team', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                      const SizedBox(height: 2),
                      Text('${team.department} · $count', style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── A meeting ──────────────────────────────────────────────────────────────

/// A meeting (OnbMeeting): who it is with, the template's agenda with a
/// notes box and voice typing under each point, Mark as met, "Only you can
/// see your notes". The notes are saved for her as she types.
class JoinerMeetingScreen extends StatefulWidget {
  const JoinerMeetingScreen({super.key, required this.shell, required this.task, this.source});

  final OnboardingShell shell;
  final TaskView task;
  final JoinerMeetingsSource? source;

  @override
  State<JoinerMeetingScreen> createState() => _JoinerMeetingScreenState();
}

class _JoinerMeetingScreenState extends State<JoinerMeetingScreen> {
  final _voice = TeamVoice();
  late final List<TextEditingController> _notes = [
    for (final (i, _) in widget.task.agenda.indexed)
      TextEditingController(text: i < widget.task.myNotes.length ? widget.task.myNotes[i] : ''),
  ];
  late bool _met = widget.task.isDone;
  bool _busy = false;
  Timer? _save;
  String _saved = '';

  TaskView get _task => widget.task;

  @override
  void initState() {
    super.initState();
    _saved = _text();
    for (final c in _notes) {
      c.addListener(_changed);
    }
  }

  String _text() => _notes.map((c) => c.text).join('\u0000');

  void _changed() {
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 800), _flush);
  }

  Future<void> _flush() async {
    _save?.cancel();
    final source = widget.source;
    final now = _text();
    if (source == null || now == _saved) return;
    _saved = now;
    try {
      await source.saveNotes(_task.id, [for (final c in _notes) c.text]);
    } catch (e) {
      _saved = '';
      if (mounted) showAppToast(context, onboardingErrorText(e));
    }
  }

  @override
  void dispose() {
    unawaited(_flush());
    _voice.dispose();
    for (final c in _notes) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _markMet() async {
    final source = widget.source;
    if (source == null) return;
    setState(() => _busy = true);
    try {
      await source.markMet(_task.id);
      if (mounted) setState(() => _met = true);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _task;
    final name = t.withName ?? t.meeting?.withWho ?? t.ownerName ?? t.title;
    final agenda = t.agenda;
    final canTick = !_met && (t.canTick ?? false) && widget.source != null;
    return OnbScaffold(
      shell: widget.shell,
      title: 'Meeting',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Container(
            key: const ValueKey('meeting-head'),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
            child: Row(
              children: [
                OnbAvatar(name: name, photoUrl: t.withPhotoUrl, size: 56),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: OnbColors.text)),
                      const SizedBox(height: 2),
                      Text(t.title, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                    ],
                  ),
                ),
                if (_met)
                  Container(
                    key: const ValueKey('meeting-met-pill'),
                    height: 26,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: OnbColors.successTint, borderRadius: BorderRadius.circular(999)),
                    child: const Text('Met', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: OnbColors.successText)),
                  ),
              ],
            ),
          ),
          if (agenda.isNotEmpty) ...[
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Expanded(
                  child: Text('Agenda', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                ),
                Text(
                  '${agenda.length} ${agenda.length == 1 ? 'thing' : 'things'} to talk about',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2),
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (final (i, point) in agenda.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
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
                            decoration: const BoxDecoration(color: OnbColors.tint, shape: BoxShape.circle),
                            child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: OnbColors.primary)),
                          ),
                          const SizedBox(width: 10),
                          Expanded(child: Text(point, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                        ],
                      ),
                      const SizedBox(height: 10),
                      TeamNotesField(field: 'agenda-$i', controller: _notes[i], voice: _voice, label: 'Your notes on $point'),
                    ],
                  ),
                ),
              ),
          ],
          const SizedBox(height: 8),
          if (_met)
            SizedBox(
              height: 52,
              child: OutlinedButton(
                key: const ValueKey('meeting-met'),
                onPressed: null,
                style: OutlinedButton.styleFrom(
                  disabledBackgroundColor: OnbColors.successTint,
                  disabledForegroundColor: OnbColors.successText,
                  side: const BorderSide(color: OnbColors.successLine),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                child: const Text('Met'),
              ),
            )
          else if (canTick)
            SizedBox(
              height: 52,
              child: FilledButton(
                key: const ValueKey('meeting-mark-met'),
                onPressed: _busy ? null : _markMet,
                style: FilledButton.styleFrom(
                  backgroundColor: OnbColors.primary,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                child: _busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Mark as met'),
              ),
            ),
          if (agenda.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text(
              'Only you can see your notes',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: OnbColors.text3),
            ),
          ],
        ],
      ),
    );
  }
}

// ─── Your team ──────────────────────────────────────────────────────────────

/// Your team (TeamList): her department, "n people", each with their
/// designation, Manager and Buddy tagged, and Say hi.
class TeamListScreen extends StatefulWidget {
  const TeamListScreen({super.key, required this.shell, this.source, this.initial});

  final OnboardingShell shell;
  final JoinerMeetingsSource? source;
  final JoinerTeam? initial;

  @override
  State<TeamListScreen> createState() => _TeamListScreenState();
}

class _TeamListScreenState extends State<TeamListScreen> {
  late JoinerTeam? _team = widget.initial;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final source = widget.source;
    if (source == null) return;
    try {
      final team = await source.fetchTeam();
      if (mounted) {
        setState(() {
          _team = team;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = _team;
    return OnbScaffold(
      shell: widget.shell,
      title: 'Your team',
      offline: team != null && _error != null,
      body: team == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Semantics(
                        header: true,
                        child: Text(team.department, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text)),
                      ),
                    ),
                    Text(
                      '${team.people.length} ${team.people.length == 1 ? 'person' : 'people'}',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (team.people.isNotEmpty)
                  Container(
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
                    child: Column(
                      children: [
                        for (final (i, p) in team.people.indexed) _PersonRow(person: p, last: i == team.people.length - 1),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.person, required this.last});

  final TeamPerson person;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final p = person;
    final first = p.name.trim().split(RegExp(r'\s+')).first;
    final (tag, tagBg, tagFg) = switch (p.tag) {
      'manager' => ('Manager', OnbColors.successTint, const Color(0xFF15803D)),
      'buddy' => ('Buddy', OnbColors.amberTint, OnbColors.amber),
      _ => (null, Colors.transparent, Colors.transparent),
    };
    return Container(
      key: ValueKey('team-${p.userId}'),
      constraints: const BoxConstraints(minHeight: 68),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: OnbColors.line))),
      child: Row(
        children: [
          OnbAvatar(name: p.name, photoUrl: p.photoUrl, size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(p.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                    ),
                    if (tag != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        height: 22,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: tagBg, borderRadius: BorderRadius.circular(999)),
                        child: Text(tag, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: tagFg)),
                      ),
                    ],
                  ],
                ),
                if (p.designation != null) ...[
                  const SizedBox(height: 3),
                  Text(p.designation!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                ],
              ],
            ),
          ),
          // Say hi: their profile, where the app reaches people (no chat yet).
          Semantics(
            button: true,
            label: 'Say hi to $first',
            excludeSemantics: true,
            child: Material(
              color: OnbColors.screen,
              shape: const CircleBorder(),
              child: InkWell(
                key: ValueKey('say-hi-${p.userId}'),
                customBorder: const CircleBorder(),
                onTap: canOpenPersonProfile && p.userId.isNotEmpty ? () => openPersonProfile(p.userId) : null,
                child: const SizedBox(width: 40, height: 40, child: Icon(Icons.chat_bubble_outline_rounded, size: 20, color: OnbColors.primary)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/// "Tasks for you": what is left over from an earlier stage on top ("From
/// Week 1"), her stage's, then COMING UP; through the lens, that stage's
/// first. Acknowledge policies opens Policies; the rest open their screens.
class OnbTasksScreen extends StatefulWidget {
  const OnbTasksScreen({super.key, required this.shell, this.policies});
  final OnboardingShell shell;

  /// Supplied by tests; the server's otherwise.
  final PoliciesSource? policies;

  @override
  State<OnbTasksScreen> createState() => _OnbTasksScreenState();
}

class _OnbTasksScreenState extends State<OnbTasksScreen> with _HomeList<OnbTasksScreen> {
  late final PoliciesSource? _policies = widget.policies ?? policiesSourceFor(widget.shell);

  @override
  OnboardingShell get shell => widget.shell;

  @override
  void initState() {
    super.initState();
    startLoading();
  }

  Future<void> _open(TaskView t) async {
    if (t.opens == 'policies') {
      final source = _policies;
      if (source == null) return;
      await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => PoliciesAckScreen(source: source, shell: shell)));
    } else {
      await openOnboardingTask(context, shell, t, home: home);
    }
    if (mounted) await load();
  }

  @override
  Widget build(BuildContext context) => OnbScaffold(
    shell: shell,
    title: 'Tasks',
    offline: home != null && error != null,
    body: lensed(
      (home, lens) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          LensSection(
            key: const ValueKey('tasks-list'),
            title: 'Tasks for you',
            meta: lens.tasksMeta,
            items: lens.tasks,
            now: shell.now(),
            onOpen: _open,
          ),
        ],
      ),
    ),
  );
}
