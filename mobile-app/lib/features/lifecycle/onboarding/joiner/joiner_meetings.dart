import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../../../profile/profile_launcher.dart';
import '../data/joiner_meetings_api.dart';
import '../data/onboarding_api.dart';
import '../presentation/manager/team_kit.dart' show TeamNotesField, TeamVoice;
import '../presentation/onboarding_kit.dart';
import 'joiner_lens.dart';
import 'joiner_models.dart';
import 'joiner_parts.dart';

/// Meetings (New joiner canvas, App · meetings): "People to meet", the topic
/// first and the person under it, pills (From Day 1, a stage, Every month),
/// COMING UP, a lock with "Opens in Month 1", the Met box (it toggles), and
/// on Day 1 and in Week 1 the Your team row.
class JoinerMeetingsScreen extends StatefulWidget {
  const JoinerMeetingsScreen({super.key, required this.c});

  final JoinerController c;

  @override
  State<JoinerMeetingsScreen> createState() => _JoinerMeetingsScreenState();
}

class _JoinerMeetingsScreenState extends State<JoinerMeetingsScreen> {
  JoinerTeam? _team;
  final Set<String> _busy = {};

  JoinerController get c => widget.c;

  @override
  void initState() {
    super.initState();
    unawaited(_loadTeam());
  }

  Future<void> _loadTeam() async {
    try {
      final team = await c.api.fetchTeam();
      if (mounted) setState(() => _team = team);
    } catch (_) {
      // No department on record: no Your team row.
    }
  }

  Future<void> _tick(JoinerMeeting m) async {
    final d = c.data;
    if (d == null || _busy.contains(m.id)) return;
    setState(() => _busy.add(m.id));
    c.set(d.withMeeting(m.copyWith(met: !m.met)));
    try {
      await c.api.setMet(m.id, !m.met);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      await c.load();
      if (mounted) setState(() => _busy.remove(m.id));
    }
  }

  @override
  Widget build(BuildContext context) => JoinerScaffold(
    c: c,
    title: 'Meetings',
    body: (d) {
      final lens = JoinerLens(d, c.lens);
      final rows = lens.meetingRows;
      final team = _team;
      final showTeam = lens.isNow && (d.step == 'd1' || d.step == 'w1') && team != null && team.people.isNotEmpty;
      return JPage(
        onRefresh: c.load,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              JSectionHead(title: 'People to meet', meta: lens.meetingsMeta),
              const SizedBox(height: 8),
              if (rows.isNotEmpty || showTeam)
                JListCard(
                  children: withLines([
                    for (final r in rows) ...[
                      if (r.head != null) JStrip(r.head!),
                      _MeetingRow(
                        row: r,
                        busy: _busy.contains(r.item.id),
                        onOpen: () => pushJoiner(context, c, JoinerMeetingScreen(c: c, id: r.item.id)),
                        onTick: () => _tick(r.item),
                      ),
                    ],
                    if (showTeam) _TeamRow(team: team, onTap: () => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => JoinerTeamScreen(c: c, initial: team)))),
                  ]),
                ),
            ],
          ),
        ],
      );
    },
  );
}

class _MeetingRow extends StatelessWidget {
  const _MeetingRow({required this.row, required this.onOpen, required this.onTick, this.busy = false});

  final LensRow<JoinerMeeting> row;
  final VoidCallback onOpen;
  final VoidCallback onTick;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final m = row.item;
    final name = m.person?.name;
    // "Ritu Sharma · HR"; locked, "Sunny Kapoor · Opens in Month 1".
    final sub = [?name, row.sub ?? m.roleLabel].join(' · ');
    final on = !row.locked && m.met;
    return Opacity(
      opacity: row.locked ? 0.6 : 1,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.only(right: 12),
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                button: !row.locked,
                label: 'Open meeting with ${name ?? m.roleLabel}. ${m.title}. $sub${row.pill == null ? '' : '. ${row.pill}'}',
                excludeSemantics: true,
                child: InkWell(
                  key: ValueKey('meeting-${m.id}'),
                  onTap: row.locked ? null : onOpen,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Row(
                      children: [
                        meetingFace(m),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(m.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: on ? OnbColors.text3 : OnbColors.text)),
                              const SizedBox(height: 2),
                              Text(sub, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                            ],
                          ),
                        ),
                        if (row.pill != null) ...[const SizedBox(width: 8), JPill(row.pill!, amber: row.amber)],
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (row.locked)
              const SizedBox(width: 40, height: 40, child: Center(child: jLock))
            else
              Semantics(
                checked: on,
                label: 'Met ${name ?? m.roleLabel}',
                excludeSemantics: true,
                child: InkResponse(
                  key: ValueKey('meeting-tick-${m.id}'),
                  onTap: busy ? null : onTick,
                  radius: 22,
                  child: SizedBox(width: 40, height: 40, child: Center(child: JTickBox(on: on))),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The Met box: a rounded square, green with a tick once met.
class JTickBox extends StatelessWidget {
  const JTickBox({super.key, required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) => Container(
    width: 26,
    height: 26,
    decoration: BoxDecoration(
      color: on ? OnbColors.successDot : Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: on ? null : Border.all(color: OnbColors.lineDark, width: 2),
    ),
    child: on ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
  );
}

/// The card's last row: three faces, "Your team", "Operations · 6 people".
class _TeamRow extends StatelessWidget {
  const _TeamRow({required this.team, required this.onTap});

  final JoinerTeam team;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final line = '${team.department} · ${plural(team.people.length, 'person', 'people')}';
    final faces = team.people.take(3).toList();
    return Semantics(
      button: true,
      label: 'Your team. $line',
      excludeSemantics: true,
      child: InkWell(
        key: const ValueKey('your-team'),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              for (final (i, p) in faces.indexed)
                Align(
                  widthFactor: i == faces.length - 1 ? 1 : 0.7,
                  child: JFace(name: p.name, photoUrl: p.photoUrl, role: p.tag ?? '', size: 32, ring: true),
                ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Your team', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text)),
                    const SizedBox(height: 2),
                    Text(line, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── A meeting ──────────────────────────────────────────────────────────────

/// A meeting (App · meetings, one open; "Monthly goals · agenda and notes"):
/// the person and who they are, Met once met, the template's agenda with
/// her own notes and voice typing under each point, Mark as met / Met (it
/// toggles), "Only you can see your notes". Notes save as she types.
class JoinerMeetingScreen extends StatefulWidget {
  const JoinerMeetingScreen({super.key, required this.c, required this.id});

  final JoinerController c;
  final String id;

  @override
  State<JoinerMeetingScreen> createState() => _JoinerMeetingScreenState();
}

class _JoinerMeetingScreenState extends State<JoinerMeetingScreen> {
  final _voice = TeamVoice();
  List<TextEditingController> _notes = const [];
  Timer? _save;
  String _saved = '';
  bool _busy = false;

  JoinerController get c => widget.c;
  JoinerMeeting? get _m => c.data?.meetings.where((m) => m.id == widget.id).firstOrNull;

  @override
  void initState() {
    super.initState();
    final m = _m;
    if (m != null) {
      _notes = [for (final (i, _) in m.agenda.indexed) TextEditingController(text: i < m.notes.length ? m.notes[i] : '')..addListener(_changed)];
    }
    _saved = _text();
  }

  String _text() => _notes.map((n) => n.text).join('\u0000');

  void _changed() {
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 800), _flush);
  }

  Future<void> _flush() async {
    _save?.cancel();
    final now = _text();
    if (now == _saved || _notes.isEmpty) return;
    _saved = now;
    try {
      await c.api.saveNotes(widget.id, [for (final n in _notes) n.text]);
    } catch (e) {
      _saved = '';
      if (mounted) showAppToast(context, onboardingErrorText(e));
    }
  }

  Future<void> _toggle(JoinerMeeting m) async {
    final d = c.data;
    if (d == null) return;
    setState(() => _busy = true);
    c.set(d.withMeeting(m.copyWith(met: !m.met)));
    try {
      await c.api.setMet(m.id, !m.met);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      await c.load();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    unawaited(_flush());
    _voice.dispose();
    for (final n in _notes) {
      n.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: c,
    builder: (context, _) {
      final m = _m;
      return JoinerScaffold(
        c: c,
        title: m?.title ?? 'Meetings',
        body: (d) {
          if (m == null) return const SizedBox.shrink();
          final (tint, fg) = roleTint(m.withRole);
          final name = m.person?.name ?? m.roleLabel;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              Container(
                key: const ValueKey('meeting-head'),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
                child: Row(
                  children: [
                    meetingFace(m, size: 56),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: OnbColors.text)),
                          const SizedBox(height: 2),
                          Text(m.roleLabel, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                        ],
                      ),
                    ),
                    if (m.met)
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
              const SizedBox(height: 16),
              JSectionHead(title: 'Agenda', meta: '${m.agenda.length} ${m.agenda.length == 1 ? 'thing' : 'things'} to talk about'),
              const SizedBox(height: 8),
              for (final (i, point) in m.agenda.indexed)
                if (i < _notes.length)
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
                                decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
                                child: Text('${i + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: fg)),
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
              const SizedBox(height: 8),
              SizedBox(
                height: 52,
                child: m.met
                    ? OutlinedButton(
                        key: const ValueKey('meeting-met'),
                        onPressed: _busy ? null : () => _toggle(m),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: OnbColors.successTint,
                          foregroundColor: OnbColors.successText,
                          side: const BorderSide(color: OnbColors.successLine),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          textStyle: OnbText.button(context),
                        ),
                        child: const Text('Met'),
                      )
                    : FilledButton(
                        key: const ValueKey('meeting-mark-met'),
                        onPressed: _busy ? null : () => _toggle(m),
                        style: FilledButton.styleFrom(
                          backgroundColor: OnbColors.primary,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          textStyle: OnbText.button(context),
                        ),
                        child: const Text('Mark as met'),
                      ),
              ),
              const SizedBox(height: 10),
              const Text('Only you can see your notes', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: OnbColors.text3)),
            ],
          );
        },
      );
    },
  );
}

// ─── Your team ──────────────────────────────────────────────────────────────

/// Your team (AppTeam): her department and how many, each person with their
/// designation, Manager and Buddy tagged, and Say hi.
class JoinerTeamScreen extends StatefulWidget {
  const JoinerTeamScreen({super.key, required this.c, this.initial});

  final JoinerController c;
  final JoinerTeam? initial;

  @override
  State<JoinerTeamScreen> createState() => _JoinerTeamScreenState();
}

class _JoinerTeamScreenState extends State<JoinerTeamScreen> {
  late JoinerTeam? _team = widget.initial;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final team = await widget.c.api.fetchTeam();
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
      shell: widget.c.shell,
      title: 'Your team',
      offline: team != null && _error != null,
      body: team == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : JPage(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    JSectionHead(title: team.department, meta: plural(team.people.length, 'person', 'people')),
                    const SizedBox(height: 8),
                    if (team.people.isNotEmpty) JListCard(children: withLines([for (final p in team.people) _PersonRow(person: p)])),
                  ],
                ),
              ],
            ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.person});

  final TeamPerson person;

  @override
  Widget build(BuildContext context) {
    final p = person;
    final first = p.name.trim().split(RegExp(r'\s+')).first;
    final tag = switch (p.tag) {
      'manager' => ('Manager', OnbColors.successTint, jGreenDark),
      'buddy' => ('Buddy', OnbColors.amberTint, OnbColors.amber),
      _ => null,
    };
    return Container(
      key: ValueKey('team-${p.userId}'),
      constraints: const BoxConstraints(minHeight: 68),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          JFace(name: p.name, photoUrl: p.photoUrl, role: p.tag ?? '', size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(child: Text(p.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: OnbColors.text))),
                    if (tag != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        height: 22,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: tag.$2, borderRadius: BorderRadius.circular(999)),
                        child: Text(tag.$1, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: tag.$3)),
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
          // Say hi: their profile, where the app reaches people.
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
