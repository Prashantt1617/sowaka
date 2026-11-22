import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/staff_api.dart';
import '../manager/team_kit.dart';
import '../onboarding_kit.dart';
import 'staff_screens.dart';

/// HR's and IT & admin's task screens (MgrTeamsProto, role hr | it, a task
/// opened): each shows what is needed to do it. The payroll check and the
/// joining form read her actual profile, the kit shows the ID card to print,
/// the letter shows a preview, each access opens to its setup details, a
/// meeting shows its agenda with my own notes. Finishing goes back to her
/// page with what was done.

const _ink = Color(0xFF16181D);
const _grey = Color(0xFF6B7080);
const _hair = Color(0xFFEFEFF2);
const _amber = Color(0xFFB45309);

// ─── Pieces ─────────────────────────────────────────────────────────────────

/// The screen's head: her photo, the task, "For Priya Shah · Week 1", Done or when it is due.
class StaffTaskHead extends StatelessWidget {
  const StaffTaskHead({super.key, required this.joiner, required this.title, required this.line, this.done = false, this.due});

  final StaffJoiner joiner;
  final String title;
  final String line;
  final bool done;
  final StaffPill? due;

  @override
  Widget build(BuildContext context) {
    final due = this.due;
    final (bg, fg) = staffTone(due?.tone ?? 'grey');
    return Container(
      key: const ValueKey('staff-task-head'),
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
                const SizedBox(height: 2),
                Text(line, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              ],
            ),
          ),
          if (done) const TeamPill('Done', background: TeamColors.okBg, foreground: Color(0xFF1F9D45), height: 26),
          if (!done && due != null) TeamPill(due.text, background: bg, foreground: fg, height: 26),
        ],
      ),
    );
  }
}

/// The how-to line under the head, behind an info icon.
class _How extends StatelessWidget {
  const _How(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.info_outline_rounded, size: 18, color: OnbColors.primary)),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13, height: 1.5, color: TeamColors.ink))),
      ],
    ),
  );
}

/// A grey capitals label over a block, with its meta on the right ("2 missing").
class _Label extends StatelessWidget {
  const _Label(this.text, {this.meta});

  final String text;
  final String? meta;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8, left: 2, right: 2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Expanded(child: Text(text.toUpperCase(), style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: _grey))),
        if (meta != null && meta!.isNotEmpty) Text(meta!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _grey)),
      ],
    ),
  );
}

/// Label / value rows; a missing value in amber.
class _KeyValues extends StatelessWidget {
  const _KeyValues(this.rows);

  final List<(String, String, bool)> rows;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: _hair)),
    child: Column(
      children: [
        for (final (i, (k, v, missing)) in rows.indexed)
          Container(
            constraints: const BoxConstraints(minHeight: 46),
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: _hair))),
            child: Row(
              children: [
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.4),
                  child: Text(k, style: const TextStyle(fontSize: 14, height: 20 / 14, color: _grey)),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: missing ? _amber : _ink)),
                ),
              ],
            ),
          ),
      ],
    ),
  );
}

/// Two choices side by side with a radio ring ("Looks right" / "Ask Priya").
class _Choices extends StatelessWidget {
  const _Choices({required this.label, required this.options, required this.value, required this.onPick});

  final String label;
  final List<(String, String)> options;
  final String? value;
  final ValueChanged<String>? onPick;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    child: Row(
      children: [
        for (final (i, (v, t)) in options.indexed) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(
            child: Semantics(
              inMutuallyExclusiveGroup: true,
              checked: value == v,
              button: true,
              child: Material(
                color: value == v ? OnbColors.screen : Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(color: value == v ? OnbColors.primary : const Color(0xFFE2E3E8)),
                ),
                child: InkWell(
                  key: ValueKey('choice-$label-$v'),
                  borderRadius: BorderRadius.circular(16),
                  onTap: onPick == null ? null : () => onPick!(v),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 48),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Container(
                          width: 20,
                          height: 20,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: value == v ? OnbColors.primary : const Color(0xFFCDD0D7), width: value == v ? 1.5 : 2),
                          ),
                          child: value == v ? Container(width: 9, height: 9, decoration: const BoxDecoration(color: OnbColors.primary, shape: BoxShape.circle)) : null,
                        ),
                        const SizedBox(width: 8),
                        Flexible(child: Text(t, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _ink))),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

/// A checklist with a square tick on the right.
class _Checks extends StatelessWidget {
  const _Checks({required this.items, required this.on, required this.onToggle});

  final List<(String, String?)> items;
  final Set<int> on;
  final ValueChanged<int> onToggle;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: _hair)),
    child: Column(
      children: [
        for (final (i, (t, v)) in items.indexed)
          Semantics(
            checked: on.contains(i),
            label: t,
            excludeSemantics: true,
            child: InkWell(
              key: ValueKey('check-$i'),
              onTap: () => onToggle(i),
              child: Container(
                constraints: const BoxConstraints(minHeight: 56),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: _hair))),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(t, style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: _ink)),
                          if (v != null) Text(v, style: const TextStyle(fontSize: 12, height: 16 / 12, color: _grey)),
                        ],
                      ),
                    ),
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: on.contains(i) ? TeamColors.tickGreen : Colors.white,
                        borderRadius: BorderRadius.circular(7),
                        border: on.contains(i) ? null : Border.all(color: const Color(0xFFCDD0D7), width: 2),
                      ),
                      child: on.contains(i) ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

/// A card of rows that each open ("ID card to print", a profile section, an access).
class StaffItems extends StatelessWidget {
  const StaffItems({super.key, required this.items});

  final List<StaffItem> items;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: _hair)),
    clipBehavior: Clip.antiAlias,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, item) in items.indexed)
          DecoratedBox(
            decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: _hair))),
            child: item,
          ),
      ],
    ),
  );
}

class StaffItem extends StatelessWidget {
  const StaffItem({super.key, required this.title, this.meta, required this.pill, required this.pillTone, required this.open, required this.onToggle, this.body = const []});

  final String title;
  final String? meta;
  final String pill;
  final String pillTone;
  final bool open;
  final VoidCallback onToggle;
  final List<Widget> body;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = staffTone(pillTone);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          expanded: open,
          button: true,
          child: InkWell(
            onTap: onToggle,
            child: Container(
              constraints: const BoxConstraints(minHeight: 60),
              padding: const EdgeInsets.fromLTRB(16, 10, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: const TextStyle(fontSize: 15, height: 20 / 15, fontWeight: FontWeight.w600, color: _ink)),
                        if (meta != null) ...[const SizedBox(height: 2), Text(meta!, style: const TextStyle(fontSize: 12, color: _grey))],
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  TeamPill(pill, background: bg, foreground: fg),
                  const SizedBox(width: 12),
                  StaffToggleIcon(open: open),
                ],
              ),
            ),
          ),
        ),
        if (open)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (i, w) in body.indexed) ...[if (i > 0) const SizedBox(height: 12), w],
              ],
            ),
          ),
      ],
    );
  }
}

/// Rows inside an opened item (label, value; missing in amber).
class StaffItemRows extends StatelessWidget {
  const StaffItemRows({super.key, required this.rows});

  final List<(String, String, bool)> rows;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final (i, (k, v, missing)) in rows.indexed)
        Container(
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: _hair))),
          child: Row(
            children: [
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.4),
                child: Text(k, style: const TextStyle(fontSize: 13, height: 18 / 13, color: _grey)),
              ),
              const SizedBox(width: 16),
              Expanded(child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontSize: 13, height: 18 / 13, fontWeight: FontWeight.w600, color: missing ? _amber : _ink))),
            ],
          ),
        ),
    ],
  );
}

/// The ID card to print, drawn from her profile.
class _IdCard extends StatelessWidget {
  const _IdCard({required this.card, required this.photoUrl});

  final StaffIdCard card;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) {
    final line = [card.designation, card.department].whereType<String>().join(' · ');
    return Container(
      key: const ValueKey('staff-id-card'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFF2F6FA), Color(0xFFE6EEF6)]),
        border: Border.all(color: const Color(0xFFDCE4EE)),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 64,
              height: 76,
              child: photoUrl == null
                  ? ColoredBox(
                      color: OnbColors.tint,
                      child: Center(child: Text(OnbAvatar.initials(card.name), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: OnbColors.primary))),
                    )
                  : FittedBox(fit: BoxFit.cover, child: OnbAvatar(name: card.name, photoUrl: photoUrl, size: 76)),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${card.company} · Employee ID'.toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: _grey)),
                const SizedBox(height: 4),
                Text(card.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _ink)),
                if (line.isNotEmpty) ...[const SizedBox(height: 4), Text(line, style: const TextStyle(fontSize: 12, color: Color(0xFF4A4E5A)))],
                if (card.employeeId != null) ...[
                  const SizedBox(height: 8),
                  Text(card.employeeId!, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, letterSpacing: 0.9, color: _ink)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The cancelled cheque, drawn from her bank details.
class _Cheque extends StatelessWidget {
  const _Cheque({required this.bank, required this.ifsc, required this.holder, required this.account});

  final String? bank;
  final String? ifsc;
  final String holder;
  final String? account;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(color: const Color(0xFFF4F8F6), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFD7E3DC))),
    clipBehavior: Clip.antiAlias,
    child: Stack(
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (bank != null) Text(bank!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _ink)),
            if (ifsc != null) ...[const SizedBox(height: 6), Text('IFSC $ifsc', style: const TextStyle(fontSize: 11, color: Color(0xFF4A4E5A)))],
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider(height: 1, color: Color(0xFFC9D6CF))),
            Text(holder, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _ink)),
            if (account != null) ...[const SizedBox(height: 6), Text('A/c $account', style: const TextStyle(fontSize: 12, letterSpacing: 0.7, color: Color(0xFF4A4E5A)))],
          ],
        ),
        Positioned(
          right: 4,
          top: 12,
          child: Transform.rotate(
            angle: -0.244,
            child: Opacity(
              opacity: 0.8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(border: Border.all(color: const Color(0xFFB23500), width: 2), borderRadius: BorderRadius.circular(4)),
                child: const Text('CANCELLED', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: Color(0xFFB23500))),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

/// The letter's preview, as the template words it.
class _Letter extends StatelessWidget {
  const _Letter({required this.head, required this.title, required this.paragraphs});

  final String head;
  final String title;
  final List<String> paragraphs;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('staff-letter'),
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: const Color(0xFFE2E3E8)),
      boxShadow: const [BoxShadow(color: Color(0x0D000000), blurRadius: 8, offset: Offset(0, 2))],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (head.isNotEmpty) Text(head.toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: _grey)),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _ink)),
        for (final (i, p) in paragraphs.indexed)
          Padding(
            // The last line is the signature, set a little apart.
            padding: EdgeInsets.only(top: i == paragraphs.length - 1 && paragraphs.length > 1 ? 18 : 10),
            child: Text(p, style: const TextStyle(fontSize: 12, height: 18 / 12, color: Color(0xFF4A4E5A))),
          ),
      ],
    ),
  );
}

/// The screen's one button.
class _Button extends StatelessWidget {
  const _Button({required this.label, required this.onTap, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 52,
    child: FilledButton(
      key: const ValueKey('staff-task-button'),
      onPressed: busy ? null : onTap,
      style: FilledButton.styleFrom(
        backgroundColor: OnbColors.primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      child: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(label),
    ),
  );
}

// ─── A task's screen ────────────────────────────────────────────────────────

/// Opens one of my rows: a meeting's agenda, or the task's own screen.
class StaffTaskPage extends StatefulWidget {
  const StaffTaskPage({super.key, required this.api, required this.page, required this.row, this.shell, this.barTitle});

  final StaffApi api;
  final OnboardingShell? shell;
  final StaffJoinerPage page;
  final StaffTaskRow row;

  /// The header's title: her name, or "All tasks" when opened from View all (as drawn).
  final String? barTitle;

  @override
  State<StaffTaskPage> createState() => _StaffTaskPageState();
}

class _StaffTaskPageState extends State<StaffTaskPage> {
  StaffTaskScreen? _screen;
  String? _error;
  bool _busy = false;

  // What the screen's answers are while it is open.
  final _picked = <String, String>{};
  final _ticked = <int>{};
  final _open = <String>{};
  final _card = TextEditingController();
  final _voice = TeamVoice();
  List<TextEditingController> _notes = const [];
  Timer? _saveNotes;
  late bool _done = widget.row.done;

  StaffJoiner get _j => widget.page.joiner;
  StaffRole get _as => widget.page.viewingAs;
  String get _first => _j.first;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    if (_saveNotes?.isActive ?? false) {
      _saveNotes!.cancel();
      unawaited(_writeNotes());
    }
    _card.dispose();
    _voice.dispose();
    for (final c in _notes) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final screen = await widget.api.fetchTask(_j.journeyId, widget.row.id, as: _as);
      if (!mounted) return;
      setState(() {
        _screen = screen;
        _done = screen.done;
        _error = null;
        _card.text = screen.accessCardNo ?? '';
        if (screen.done) _ticked.addAll(List.generate(8, (i) => i));
        _notes = [
          for (final (i, _) in (screen.agenda.isEmpty ? const [''] : screen.agenda).indexed)
            TextEditingController(text: i < screen.notes.length ? screen.notes[i] : '')..addListener(_notesChanged),
        ];
      });
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  void _notesChanged() {
    _saveNotes?.cancel();
    _saveNotes = Timer(const Duration(milliseconds: 800), () => unawaited(_writeNotes()));
  }

  Future<void> _writeNotes() async {
    try {
      await widget.api.saveNotes(_j.journeyId, widget.row.id, [for (final c in _notes) c.text], as: _as);
    } catch (_) {
      // Kept on the screen; the next change tries again.
    }
  }

  /// Sends the screen's answers and goes back to her page with [said].
  Future<void> _finish(String said, {String? action = 'done', Map<String, String>? checks, String? accessCardNo, Map<String, bool>? accesses}) async {
    setState(() => _busy = true);
    try {
      await widget.api.taskAction(_j.journeyId, widget.row.id, action: action, checks: checks, accessCardNo: accessCardNo, accesses: accesses, as: _as);
      if (mounted) Navigator.of(context).pop(said);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// A meeting's Mark as done / Done: a tick both ways, on the same screen.
  Future<void> _toggleMeeting() async {
    setState(() => _busy = true);
    try {
      await widget.api.taskAction(_j.journeyId, widget.row.id, action: _done ? 'undo' : 'done', as: _as);
      if (mounted) setState(() => _done = !_done);
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _pick(String key, String value) => setState(() => _picked[key] = value);
  String? _choice(String key, String? kept) => _picked[key] ?? kept;

  @override
  Widget build(BuildContext context) {
    final screen = _screen;
    return staffPage(
      context,
      shell: widget.shell,
      title: widget.barTitle ?? _j.name,
      body: screen == null ? OnbLoadState(error: _error, onRetry: _error == null ? null : _load) : staffList(widget.row.isMeeting ? _meeting(screen) : _task(screen)),
    );
  }

  // ─── A meeting ──────────────────────────────────────────────────────────

  List<Widget> _meeting(StaffTaskScreen screen) {
    final due = widget.row.shownPill;
    final (bg, fg) = staffTone(due?.tone ?? 'grey');
    final agenda = screen.agenda;
    return [
      Container(
        key: const ValueKey('staff-meeting-head'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
        child: Row(
          children: [
            OnbAvatar(name: _j.name, photoUrl: _j.photoUrl, size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.row.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                  const SizedBox(height: 2),
                  Text('With ${_j.name}', style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                ],
              ),
            ),
            if (_done) const TeamPill('Done', background: TeamColors.okBg, foreground: Color(0xFF1F9D45), height: 26),
            if (!_done && due != null) TeamPill(due.text, background: bg, foreground: fg, height: 26),
          ],
        ),
      ),
      if (agenda.isNotEmpty) TeamSectionTitle('Agenda', meta: '${agenda.length} things to talk about'),
      for (final (i, point) in (agenda.isEmpty ? const ['Anything to talk about'] : agenda).indexed)
        Container(
          key: ValueKey('staff-agenda-$i'),
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
      SizedBox(
        height: 52,
        child: _done
            ? OutlinedButton(
                key: const ValueKey('staff-meeting-done'),
                onPressed: _busy ? null : _toggleMeeting,
                style: OutlinedButton.styleFrom(
                  backgroundColor: TeamColors.okBg,
                  foregroundColor: const Color(0xFF1F9D45),
                  side: const BorderSide(color: Color(0xFFCFE3D6)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                child: const Text('Done'),
              )
            : FilledButton(
                key: const ValueKey('staff-meeting-mark'),
                onPressed: _busy ? null : _toggleMeeting,
                style: FilledButton.styleFrom(
                  backgroundColor: OnbColors.primary,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                child: const Text('Mark as done'),
              ),
      ),
      TeamFootnote('Only you can see your notes. $_first keeps their own.'),
    ];
  }

  // ─── A task ─────────────────────────────────────────────────────────────

  List<Widget> _task(StaffTaskScreen screen) {
    final row = widget.row;
    final opens = row.opens ?? 'plain';
    final accesses = opens == 'accesses';
    final head = StaffTaskHead(
      joiner: _j,
      title: row.title,
      line: 'For ${_j.name} · ${_j.stepLabel}',
      // The accesses screen is saved, never "done" from here (it is done when every access is ready).
      done: _done && !accesses,
      due: _done ? null : row.shownPill,
    );
    final how = row.how;
    final blocks = switch (opens) {
      'kit' => _kit(screen),
      'handover' => _handover(screen),
      'payroll' => _payroll(screen),
      'form' => _form(screen),
      'letter' => _letter(screen),
      'accesses' => _accesses(screen),
      _ => <Widget>[if (!_done) _Button(label: 'Mark as done', busy: _busy, onTap: () => _finish('Marked as done'))],
    };
    return [head, if (how != null) _How(how), ...blocks];
  }

  List<Widget> _kit(StaffTaskScreen screen) {
    final card = screen.idCard;
    final their = screen.possessive;
    return [
      if (card != null) ...[
        const _Label('ID card'),
        StaffItems(
          items: [
            StaffItem(
              key: const ValueKey('staff-item-id'),
              title: 'ID card to print',
              meta: 'From $their profile',
              pill: 'Ready to print',
              pillTone: 'green',
              open: _open.contains('id'),
              onToggle: () => setState(() => _open.contains('id') ? _open.remove('id') : _open.add('id')),
              body: [
                _IdCard(card: card, photoUrl: _j.photoUrl),
                StaffItemRows(rows: [
                  if (card.bloodGroup != null) ('Blood group', card.bloodGroup!, false),
                  if (card.emergencyContact != null) ('Emergency contact', card.emergencyContact!, false),
                  ('Photo', card.photoUploaded ? 'Uploaded' : 'Not uploaded yet', !card.photoUploaded),
                ]),
              ],
            ),
          ],
        ),
      ],
      const _Label('Welcome kit'),
      _Checks(
        items: const [('T-shirt', null), ('Mug and bottle', null), ('Notebook and pen', null), ('Laptop bag', null), ('Access card', null)],
        on: _ticked,
        onToggle: (i) => setState(() => _ticked.contains(i) ? _ticked.remove(i) : _ticked.add(i)),
      ),
      if (!_done) _Button(label: 'Kit ready', busy: _busy, onTap: () => _finish('Onboarding kit ready for $_first')),
    ];
  }

  List<Widget> _handover(StaffTaskScreen screen) => [
    const _Label('Hand over'),
    _Checks(
      items: [('ID card', screen.idCard?.employeeId), ('Access card', null), ('T-shirt', null), ('Mug and bottle', null), ('Notebook and pen', null), ('Laptop bag', null)],
      on: _ticked,
      onToggle: (i) => setState(() => _ticked.contains(i) ? _ticked.remove(i) : _ticked.add(i)),
    ),
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Access card number', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _ink)),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('staff-access-card'),
          controller: _card,
          style: const TextStyle(fontSize: 14, color: _ink),
          decoration: InputDecoration(
            hintText: 'Printed on the back of the card',
            hintStyle: const TextStyle(fontSize: 14, color: OnbColors.text3),
            isDense: true,
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.lineDark)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.primary)),
          ),
        ),
      ],
    ),
    if (!_done)
      _Button(
        label: 'Handed over',
        busy: _busy,
        onTap: () => _finish('Kit handed over to $_first', accessCardNo: _card.text.trim().isEmpty ? null : _card.text.trim()),
      ),
  ];

  /// "Looks right" / "Ask Priya" under a section; kept as looks_right / ask.
  Widget _looks(StaffTaskScreen screen, String key, String label) => _Choices(
    label: label,
    options: [('looks_right', 'Looks right'), ('ask', 'Ask $_first')],
    value: _choice(key, screen.checks[key]),
    onPick: _done ? null : (v) => _pick(key, v),
  );

  List<(String, String, bool)> _rows(StaffSection s) => [for (final r in s.rows) (r.label, r.value ?? 'Not filled yet', r.value == null)];

  List<Widget> _payroll(StaffTaskScreen screen) {
    StaffSection? sec(String key) => screen.sections.where((s) => s.key == key).firstOrNull;
    final bank = sec('bank');
    final pf = sec('pf');
    final tax = sec('tax');
    String? value(StaffSection? s, String label) => s?.rows.where((r) => r.label == label).firstOrNull?.value;
    final chequeChoice = _choice('cheque', screen.checks['cheque']);
    final (chequePill, chequeTone) = switch (chequeChoice) {
      'matches' => ('Matches', 'green'),
      'mismatch' => ('Doesn’t match', 'red'),
      _ => screen.cheque == true ? ('To check', 'grey') : ('Not uploaded', 'amber'),
    };
    return [
      if (bank != null) ...[
        _Label(bank.title),
        _KeyValues(_rows(bank)),
        if (screen.cheque != null)
          StaffItems(
            items: [
              StaffItem(
                key: const ValueKey('staff-item-cheque'),
                title: 'Cancelled cheque',
                meta: screen.cheque! ? 'Uploaded with ${screen.possessive} bank details' : 'Not uploaded yet',
                pill: chequePill,
                pillTone: chequeTone,
                open: _open.contains('cheque'),
                onToggle: () => setState(() => _open.contains('cheque') ? _open.remove('cheque') : _open.add('cheque')),
                body: [
                  if (screen.cheque!) ...[
                    _Cheque(bank: value(bank, 'Bank'), ifsc: value(bank, 'IFSC'), holder: value(bank, 'Account holder') ?? _j.name, account: value(bank, 'Account number')),
                    _Choices(
                      label: 'Cancelled cheque',
                      options: const [('matches', 'Matches'), ('mismatch', 'Doesn’t match')],
                      value: chequeChoice,
                      onPick: _done ? null : (v) => _pick('cheque', v),
                    ),
                  ],
                ],
              ),
            ],
          ),
        _looks(screen, 'bank', bank.title),
      ],
      if (pf != null) ...[
        _Label(pf.title, meta: pf.missing > 0 ? '${pf.missing} missing' : null),
        _KeyValues(_rows(pf)),
        _looks(screen, 'pf', pf.title),
      ],
      if (tax != null) ...[
        _Label(tax.title, meta: tax.missing > 0 ? '${tax.missing} missing' : tax.meta),
        _KeyValues(_rows(tax)),
        _looks(screen, 'tax', tax.title),
      ],
      if (!_done)
        _Button(
          label: 'Done',
          busy: _busy,
          onTap: () => _finish('Payroll details checked', checks: {
            for (final k in ['bank', 'cheque', 'pf', 'tax'])
              if (_choice(k, screen.checks[k]) != null) k: _choice(k, screen.checks[k])!,
          }),
        ),
    ];
  }

  List<Widget> _form(StaffTaskScreen screen) => [
    for (final s in screen.sections) ...[
      _Label(s.title, meta: s.missing > 0 ? '${s.missing} missing' : null),
      _KeyValues(_rows(s)),
      _looks(screen, s.key, s.title),
    ],
    if (!_done)
      _Button(
        label: 'Done',
        busy: _busy,
        onTap: () => _finish('Joining form checked', checks: {
          for (final s in screen.sections)
            if (_choice(s.key, screen.checks[s.key]) != null) s.key: _choice(s.key, screen.checks[s.key])!,
        }),
      ),
  ];

  List<Widget> _letter(StaffTaskScreen screen) {
    final preview = screen.preview;
    return [
      if (screen.facts.isNotEmpty) ...[
        const _Label('Confirmation'),
        _KeyValues([for (final f in screen.facts) (f.label, f.value, false)]),
      ],
      if (preview != null) ...[
        const _Label('Letter preview', meta: 'From Document templates'),
        _Letter(head: preview.head, title: preview.title, paragraphs: preview.paragraphs),
      ],
    ];
  }

  List<Widget> _accesses(StaffTaskScreen screen) {
    String? state(StaffAccess a) => _picked[a.id] ?? (a.ready ? 'ok' : null);
    final ready = screen.accesses.where((a) => state(a) == 'ok').length;
    return [
      _Label('Accesses', meta: '$ready of ${screen.accesses.length} ready'),
      StaffItems(
        items: [
          for (final a in screen.accesses)
            StaffItem(
              key: ValueKey('staff-access-${a.id}'),
              title: a.title,
              pill: state(a) == 'ok' ? 'Ready' : 'Setting up',
              pillTone: state(a) == 'ok' ? 'green' : 'amber',
              open: _open.contains(a.id),
              onToggle: () => setState(() => _open.contains(a.id) ? _open.remove(a.id) : _open.add(a.id)),
              body: [
                if (a.details.isNotEmpty) StaffItemRows(rows: [for (final d in a.details) (d.label, d.value, false)]),
                _Choices(label: a.title, options: const [('ok', 'Ready'), ('no', 'Not yet')], value: state(a), onPick: (v) => _pick(a.id, v)),
              ],
            ),
        ],
      ),
      _Button(
        label: 'Save',
        busy: _busy,
        onTap: () => _finish('Saved. $_first sees what’s ready.', action: null, accesses: {
          for (final a in screen.accesses)
            if (state(a) != null) a.id: state(a) == 'ok',
        }),
      ),
    ];
  }
}
