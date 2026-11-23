import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/lifecycle_me_store.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart' show LifecycleMe;
import '../../data/staff_api.dart';
import '../../onboarding_launcher.dart' show currentOnboardingShell;
import '../manager/team_kit.dart';
import '../onboarding_kit.dart';
import 'staff_task_screens.dart';

/// HR and IT & admin in the app (Onboarding · Final designs, canvas page 4
/// "App · HR, IT & admin"; prototype MgrTeamsProto with role hr | it):
/// Actions › Onboarding (the highlighted tile), the four stage cards, View
/// all employees, a person's page (that role's tasks with when each is due,
/// then her whole onboarding), each stat's list and the full profile. They
/// never see joiners in Teams. Every number and pill is the server's
/// (`/lifecycle/staff/*`, FINAL-DESIGNS.md §4.4).

// ─── The Actions tile ───────────────────────────────────────────────────────

/// What `/lifecycle/me` says for HR or IT & admin: their Onboarding tile, or
/// null when nobody joining is theirs.
StaffTile? staffTileOf(LifecycleMe me) => me.enabled ? StaffTile.maybe(me.staff) : null;

/// The tile's subtitle: "n tasks for new joiners" or "All done".
String staffTileSubtitle(StaffTile tile) => tile.open > 0 ? '${tile.open} task${tile.open == 1 ? '' : 's'} for new joiners' : 'All done';

/// The tile's pill colours (late red, due today amber, else grey), from the server's counts.
(Color, Color) staffTilePillColors(StaffTile tile) =>
    tile.late > 0 ? _tone('red') : tile.dueToday > 0 ? _tone('amber') : _tone('grey');

/// Actions › Onboarding. Back on Actions, `/lifecycle/me` is read again so
/// the tile's counts follow what was done.
Future<void> openStaffOnboarding(BuildContext context, {OnboardingShell? shell, StaffApi? api}) async {
  final resolved = shell ?? currentOnboardingShell();
  final staffApi = api ?? (resolved == null ? null : HttpStaffApi.from(resolved.api));
  if (staffApi == null) return;
  await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => StaffOnboardingScreen(api: staffApi, shell: resolved)));
  if (resolved != null) unawaited(LifecycleMeStore.instance.refresh(resolved.api));
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

/// A page in the app's frame (header, back + title, tabs); a bare scaffold in tests.
Widget staffPage(BuildContext context, {required OnboardingShell? shell, required String title, required Widget body}) {
  if (shell != null) return OnbScaffold(shell: shell, title: title, body: body);
  return Scaffold(backgroundColor: OnbColors.screen, appBar: AppBar(title: Text(title)), body: body);
}

/// The design's pill colours by the server's tone.
(Color, Color) _tone(String tone) => switch (tone) {
  'red' => (const Color(0xFFFDECE7), const Color(0xFFB23500)),
  'amber' || 'warn' => (TeamColors.warnBg, TeamColors.warnFg),
  'green' || 'ok' => (TeamColors.okBg, TeamColors.okFg),
  'blue' => (TeamColors.blueBg, OnbColors.primary),
  'soon' => (OnbColors.screen, OnbColors.text3),
  _ => (OnbColors.screen, OnbColors.text2),
};

(Color, Color) staffTone(String tone) => _tone(tone);

/// The page's list with the design's 14 between blocks.
Widget staffList(List<Widget> children) => ListView.separated(
  padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
  itemCount: children.length,
  separatorBuilder: (_, _) => const SizedBox(height: 14),
  itemBuilder: (_, i) => children[i],
);

/// A heading over a block with its meta on the right ("Everyone in onboarding · 6 employees").
class StaffHeading extends StatelessWidget {
  const StaffHeading(this.title, {super.key, this.meta, this.weight = FontWeight.w700, this.metaColor = OnbColors.text2, this.metaWeight = FontWeight.w600});

  final String title;
  final String? meta;
  final FontWeight weight;
  final Color metaColor;
  final FontWeight metaWeight;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.baseline,
    textBaseline: TextBaseline.alphabetic,
    children: [
      Expanded(child: Semantics(header: true, child: Text(title, style: TextStyle(fontSize: 16, fontWeight: weight, color: TeamColors.ink)))),
      if (meta != null && meta!.isNotEmpty) Text(meta!, style: TextStyle(fontSize: 12, fontWeight: metaWeight, color: metaColor)),
    ],
  );
}

/// A screen that reads before it shows, and reads again on demand.
mixin _Reads<W extends StatefulWidget, T> on State<W> {
  T? data;
  String? error;

  Future<T> read();

  Future<void> load() async {
    try {
      final value = await read();
      if (!mounted) return;
      setState(() {
        data = value;
        error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => error = onboardingErrorText(e));
    }
  }

  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Widget loading() => OnbLoadState(error: error, onRetry: error == null ? null : load);
}

/// A joiner on a card or in View all employees: photo or initials, name, stage, worst pill, chevron.
class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.person, required this.onTap});

  final StaffPerson person;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _tone(person.pill.tone);
    return Material(
      color: const Color(0xFFFCFCFD),
      child: InkWell(
        key: ValueKey('staff-person-${person.journeyId}'),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 60),
          padding: const EdgeInsets.fromLTRB(24, 8, 6, 8),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: OnbColors.line))),
          child: Row(
            children: [
              OnbAvatar(name: person.name, photoUrl: person.photoUrl, size: 36),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(person.name, style: const TextStyle(fontSize: 14, height: 1.35, color: TeamColors.ink)),
                    const SizedBox(height: 2),
                    Text(person.stepLabel, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              TeamPill(person.pill.text, background: bg, foreground: fg),
              const SizedBox(width: 40, height: 40, child: Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The plus / minus in a grey circle on a card that opens.
class StaffToggleIcon extends StatelessWidget {
  const StaffToggleIcon({super.key, required this.open});

  final bool open;

  @override
  Widget build(BuildContext context) => Container(
    width: 26,
    height: 26,
    decoration: const BoxDecoration(color: OnbColors.screen, shape: BoxShape.circle),
    child: Icon(open ? Icons.remove_rounded : Icons.add_rounded, size: 16, color: OnbColors.text2),
  );
}

// ─── Actions › Onboarding ───────────────────────────────────────────────────

/// HROnboarding / ITOnboarding: "Viewing as HR", four cards (Joining soon,
/// Week 1, Month 1, Probation) with how many and a late pill, each opening
/// to its people; View all employees.
class StaffOnboardingScreen extends StatefulWidget {
  const StaffOnboardingScreen({super.key, required this.api, this.shell, this.viewAs});

  final StaffApi api;
  final OnboardingShell? shell;
  final StaffRole? viewAs;

  @override
  State<StaffOnboardingScreen> createState() => _StaffOnboardingScreenState();
}

class _StaffOnboardingScreenState extends State<StaffOnboardingScreen> with _Reads<StaffOnboardingScreen, StaffOnboarding> {
  late StaffRole? _as = widget.viewAs;
  final _open = <String>{};

  @override
  Future<StaffOnboarding> read() => widget.api.fetchOnboarding(as: _as);

  Future<void> _openPerson(StaffPerson person, StaffRole role) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(
      builder: (_) => StaffPersonScreen(api: widget.api, shell: widget.shell, journeyId: person.journeyId, name: person.name, as: role),
    ));
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final data = this.data;
    final me = widget.shell?.viewerName ?? '';
    return staffPage(
      context,
      shell: widget.shell,
      title: 'Onboarding',
      body: data == null
          ? loading()
          : RefreshIndicator(
              onRefresh: load,
              child: staffList([
                // "Viewing as HR" (someone who is both can switch by tapping it).
                Align(
                  alignment: Alignment.centerLeft,
                  child: GestureDetector(
                    key: const ValueKey('staff-viewing-as'),
                    onTap: data.canSwitch
                        ? () {
                            _as = data.viewingAs == StaffRole.hr ? StaffRole.it : StaffRole.hr;
                            unawaited(load());
                          }
                        : null,
                    child: Container(
                      height: 30,
                      padding: const EdgeInsets.only(left: 4, right: 12),
                      decoration: BoxDecoration(color: TeamColors.blueBg, borderRadius: BorderRadius.circular(999)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 22,
                            height: 22,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(color: OnbColors.primary, shape: BoxShape.circle),
                            child: Text(me.isEmpty ? '' : me.trim()[0].toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.white)),
                          ),
                          const SizedBox(width: 6),
                          Text('Viewing as ${data.viewingAs.label}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.primary)),
                        ],
                      ),
                    ),
                  ),
                ),
                for (final card in data.cards) _stageCard(card, data.viewingAs),
                SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    key: const ValueKey('staff-view-all'),
                    onPressed: () async {
                      await Navigator.of(context).push<void>(MaterialPageRoute(
                        builder: (_) => StaffAllScreen(everyone: data.everyone, shell: widget.shell, onOpen: (ctx, p) => _openPerson(p, data.viewingAs)),
                      ));
                    },
                    style: OutlinedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: OnbColors.primary,
                      side: const BorderSide(color: OnbColors.lineDark),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      // With the family: a button's own style replaces the theme's, and the words drew in the system font.
                      textStyle: const TextStyle(fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('View all employees'),
                  ),
                ),
              ]),
            ),
    );
  }

  Widget _stageCard(StaffCard card, StaffRole role) {
    final open = _open.contains(card.key);
    final has = card.people.isNotEmpty;
    final (lateBg, lateFg) = _tone('red');
    return Container(
      key: ValueKey('staff-card-${card.key}'),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: Colors.white,
            child: InkWell(
              onTap: has ? () => setState(() => open ? _open.remove(card.key) : _open.add(card.key)) : null,
              child: Semantics(
                expanded: has ? open : null,
                child: Container(
                  constraints: const BoxConstraints(minHeight: 68),
                  padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(card.title, style: const TextStyle(fontSize: 16, height: 1.3, fontWeight: FontWeight.w600, color: TeamColors.ink)),
                            const SizedBox(height: 3),
                            Text(
                              card.count == 0 ? 'No one right now' : '${card.count} employee${card.count == 1 ? '' : 's'}',
                              style: const TextStyle(fontSize: 12, color: OnbColors.text3),
                            ),
                          ],
                        ),
                      ),
                      if (card.late > 0) ...[const SizedBox(width: 12), TeamPill('${card.late} late', background: lateBg, foreground: lateFg)],
                      if (has) ...[const SizedBox(width: 12), StaffToggleIcon(open: open)],
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (open)
            for (final person in card.people) _PersonRow(person: person, onTap: () => _openPerson(person, role)),
        ],
      ),
    );
  }
}

/// HRAll: "Everyone in onboarding · n employees".
class StaffAllScreen extends StatelessWidget {
  const StaffAllScreen({super.key, required this.everyone, required this.onOpen, this.shell});

  final List<StaffPerson> everyone;
  final OnboardingShell? shell;
  final void Function(BuildContext context, StaffPerson person) onOpen;

  @override
  Widget build(BuildContext context) => staffPage(
    context,
    shell: shell,
    title: 'All employees',
    body: staffList([
      Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
              child: StaffHeading(
                'Everyone in onboarding',
                meta: '${everyone.length} employee${everyone.length == 1 ? '' : 's'}',
                weight: FontWeight.w600,
                metaColor: OnbColors.text3,
                metaWeight: FontWeight.w400,
              ),
            ),
            for (final person in everyone) _PersonRow(person: person, onTap: () => onOpen(context, person)),
          ],
        ),
      ),
    ]),
  );
}

// ─── A person's page ────────────────────────────────────────────────────────

/// The rows as the page shows them: what is open now (late first, as the
/// server orders them), then what was done at this step, then COMING UP: the
/// next step's rows (meetings locked until then, other tasks open early).
({List<StaffTaskRow> now, List<StaffTaskRow> soon}) staffRowsNow(StaffJoinerPage page) {
  final cur = page.step;
  final now = [
    ...page.tasks.where((t) => !t.done && (t.step <= cur)),
    ...page.tasks.where((t) => t.done && t.step == cur),
  ];
  final later = page.tasks.where((t) => t.step > cur).map((t) => t.step);
  if (later.isEmpty) return (now: now, soon: const []);
  final next = later.reduce((a, b) => a < b ? a : b);
  return (now: now, soon: page.tasks.where((t) => t.step == next).toList());
}

/// The kind's icon tile.
TeamTaskKind staffKind(String kind) => TeamTaskKind.values.firstWhere((k) => k.name == kind, orElse: () => TeamTaskKind.task);

/// One of my rows: icon, title (struck once done), what the joiner sees for it
/// or "Opens in Week 1", the due or stage pill, a chevron (or a lock).
Widget staffTaskRow(StaffJoiner joiner, StaffTaskRow row, {required VoidCallback onOpen, bool divider = true}) {
  final pill = row.shownPill;
  final (bg, fg) = _tone(pill?.tone ?? 'grey');
  final opensIn = row.stepLabel == 'Confirmed' ? 'Opens once confirmed' : 'Opens in ${row.stepLabel}';
  return TeamTaskRow(
    key: ValueKey('staff-row-${row.id}'),
    kind: staffKind(row.kind),
    title: row.title,
    pairName: joiner.name,
    pairPhotoUrl: joiner.photoUrl,
    pairLabel: row.locked ? null : row.pair,
    sub: row.locked ? opensIn : (row.pair == null ? row.note : null),
    pill: pill?.text,
    pillBg: bg,
    pillFg: fg,
    end: row.locked ? TeamRowEnd.locked : TeamRowEnd.chevron,
    done: row.done,
    onOpen: row.locked ? null : onOpen,
    divider: divider,
  );
}

/// The stat rows' bar colours.
const _barOf = <String, Color>{
  'prof': Color(0xFFB45309),
  'meet': Color(0xFF15803D),
  'tasks': Color(0xFF6B4FBB),
  'ci': Color(0xFF0571A6),
  'tour': Color(0xFFB23500),
  'watch': Color(0xFF0571A6),
  'dev': Color(0xFF2563EB),
};

/// HRPerson / ITPerson: the hero, "Your tasks for Priya" (what is due now,
/// View all), then "Priya’s onboarding": status and the seven stats, each
/// opening its list (Profile opens the full profile).
class StaffPersonScreen extends StatefulWidget {
  const StaffPersonScreen({super.key, required this.api, required this.journeyId, required this.name, this.shell, this.as});

  final StaffApi api;
  final OnboardingShell? shell;
  final String journeyId;

  /// The list's name, for the title while the page reads.
  final String name;
  final StaffRole? as;

  @override
  State<StaffPersonScreen> createState() => _StaffPersonScreenState();
}

class _StaffPersonScreenState extends State<StaffPersonScreen> with _Reads<StaffPersonScreen, StaffJoinerPage> {
  @override
  Future<StaffJoinerPage> read() => widget.api.fetchJoiner(widget.journeyId, as: widget.as);

  Future<void> _push(Widget page) async {
    final said = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => page));
    await load();
    if (said != null && mounted) showAppToast(context, said);
  }

  Future<void> _openTask(StaffJoinerPage page, StaffTaskRow row, {String? barTitle}) => _push(
    StaffTaskPage(api: widget.api, shell: widget.shell, page: page, row: row, barTitle: barTitle),
  );

  void _openProfile(StaffJoinerPage page) => _push(StaffProfileScreen(api: widget.api, shell: widget.shell, joiner: page.joiner, as: page.viewingAs));

  @override
  Widget build(BuildContext context) {
    final page = data;
    return staffPage(
      context,
      shell: widget.shell,
      title: page?.joiner.name ?? widget.name,
      body: page == null ? loading() : RefreshIndicator(onRefresh: load, child: staffList(_body(page))),
    );
  }

  List<Widget> _body(StaffJoinerPage page) {
    final j = page.joiner;
    final split = staffRowsNow(page);
    var due = split.now.where((t) => !t.done && !t.locked).toList();
    if (due.isEmpty) due = split.soon.where((t) => !t.locked && !t.done).toList();
    final hub = due.take(3).toList();
    final next = split.soon.firstOrNull;
    return [
      TeamPersonHero(
        name: j.name,
        photoUrl: j.photoUrl,
        designation: j.designation,
        reportsLine: j.reportsTo == 'you' ? 'Reports to you' : 'Reports to ${j.reportsTo}',
        buddyLine: j.buddy == 'you' ? 'You’re the buddy' : j.buddy != null ? 'Buddy: ${j.buddy}' : 'No buddy yet',
        buddyIsYou: j.buddy == 'you',
        stage: j.stepLabel,
        plant: j.plant,
        onOpenProfile: () => _openProfile(page),
      ),
      TeamTasksCard(
        title: page.cardTitle,
        openCount: page.toDo,
        rows: [
          for (final (i, row) in hub.indexed) staffTaskRow(j, row, onOpen: () => _openTask(page, row), divider: i < hub.length - 1),
        ],
        emptyText: next == null ? 'Nothing due right now.' : 'Nothing due right now. Next: ${next.title}',
        onViewAll: () => _push(StaffAllTasksScreen(api: widget.api, shell: widget.shell, journeyId: widget.journeyId, as: page.viewingAs, initial: page)),
      ),
      Padding(
        padding: const EdgeInsets.only(top: 6, left: 2, right: 2),
        child: StaffHeading('${j.first}’s onboarding', meta: page.status, weight: FontWeight.w600, metaColor: OnbColors.text3, metaWeight: FontWeight.w400),
      ),
      _StatsCard(page: page, onOpen: (stat) {
        if (stat.key == 'prof') return _openProfile(page);
        _push(StaffListScreen(shell: widget.shell, page: page, stat: stat));
      }),
    ];
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard({required this.page, required this.onOpen});

  final StaffJoinerPage page;
  final void Function(StaffStat stat) onOpen;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('staff-stats'),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: [
        for (final (i, stat) in page.stats.indexed)
          Builder(builder: (context) {
            final (bg, fg) = _tone(stat.flag.tone == 'todo' ? 'grey' : stat.flag.tone);
            return TeamStatRow(
              key: ValueKey('staff-stat-${stat.key}'),
              title: stat.title,
              value: stat.value,
              meta: stat.unit,
              fraction: stat.fraction,
              bar: _barOf[stat.key] ?? OnbColors.primary,
              flag: stat.flag.text,
              flagBg: bg,
              flagFg: fg,
              onTap: () => onOpen(stat),
              divider: i < page.stats.length - 1,
            );
          }),
      ],
    ),
  );
}

/// View all: "Your tasks for Priya · n to do", now then COMING UP.
class StaffAllTasksScreen extends StatefulWidget {
  const StaffAllTasksScreen({super.key, required this.api, required this.journeyId, required this.initial, this.shell, this.as});

  final StaffApi api;
  final OnboardingShell? shell;
  final String journeyId;
  final StaffRole? as;
  final StaffJoinerPage initial;

  @override
  State<StaffAllTasksScreen> createState() => _StaffAllTasksScreenState();
}

class _StaffAllTasksScreenState extends State<StaffAllTasksScreen> with _Reads<StaffAllTasksScreen, StaffJoinerPage> {
  @override
  void initState() {
    data = widget.initial;
    super.initState();
  }

  @override
  Future<StaffJoinerPage> read() => widget.api.fetchJoiner(widget.journeyId, as: widget.as);

  Future<void> _open(StaffJoinerPage page, StaffTaskRow row) async {
    final said = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => StaffTaskPage(api: widget.api, shell: widget.shell, page: page, row: row, barTitle: 'All tasks'),
    ));
    await load();
    if (said != null && mounted) showAppToast(context, said);
  }

  @override
  Widget build(BuildContext context) {
    final page = data!;
    final split = staffRowsNow(page);
    final rows = <Widget>[];
    for (final (i, row) in split.now.indexed) {
      rows.add(staffTaskRow(page.joiner, row, onOpen: () => _open(page, row), divider: i < split.now.length - 1 || split.soon.isNotEmpty));
    }
    if (split.soon.isNotEmpty) rows.add(const TeamListHead('Coming up'));
    for (final (i, row) in split.soon.indexed) {
      rows.add(staffTaskRow(page.joiner, row, onOpen: () => _open(page, row), divider: i < split.soon.length - 1));
    }
    return staffPage(
      context,
      shell: widget.shell,
      title: page.joiner.name,
      body: staffList([
        StaffHeading(page.cardTitle, meta: page.toDo > 0 ? '${page.toDo} to do' : 'All done for now'),
        TeamListCard(radius: 16, children: rows),
      ]),
    );
  }
}

/// A stat's list (Meetings, Tasks, Check-ins, Sowaka tour, Watch list,
/// Devices and accesses): now, then COMING UP.
class StaffListScreen extends StatelessWidget {
  const StaffListScreen({super.key, required this.page, required this.stat, this.shell});

  final StaffJoinerPage page;
  final StaffStat stat;
  final OnboardingShell? shell;

  @override
  Widget build(BuildContext context) {
    final all = page.lists[stat.key] ?? const <StaffListRow>[];
    final now = all.where((r) => !r.comingUp).toList();
    final later = all.where((r) => r.comingUp).toList();
    final first = page.joiner.first;
    final meta = switch (stat.key) {
      'meet' => '${now.where((r) => r.status == 'Met').length} of ${now.length} met',
      'tasks' => () {
        final left = now.where((r) => r.status != 'Done').length;
        return left > 0 ? '$left to do' : 'All done';
      }(),
      _ => null,
    };
    final note = switch (stat.key) {
      'meet' => 'Meeting notes stay private to $first.',
      'dev' => 'IT and admin tick these off as they set them up.',
      _ => null,
    };
    Widget row(StaffListRow r, {required bool last, String? meta}) {
      final (bg, fg) = _tone(r.tone);
      return TeamStatusRow(title: r.title, meta: meta ?? r.meta, status: r.status, bg: bg, fg: fg, divider: !last);
    }

    return staffPage(
      context,
      shell: shell,
      title: page.joiner.name,
      body: staffList([
        StaffHeading(stat.title, meta: meta),
        TeamListCard(
          radius: 16,
          children: [
            for (final (i, r) in now.indexed) row(r, last: i == now.length - 1 && later.isEmpty),
            if (later.isNotEmpty) const TeamListHead('Coming up'),
            for (final (i, r) in later.indexed) row(r, last: i == later.length - 1, meta: r.meta ?? r.status),
          ],
        ),
        if (note != null) TeamFootnote(note),
      ]),
    );
  }
}

// ─── The full profile ───────────────────────────────────────────────────────

/// HRProfile: "Priya’s profile · 86% complete", nine sections (IT sees the
/// first five), each "n missing" or Complete, opening to its rows with
/// anything missing in amber.
class StaffProfileScreen extends StatefulWidget {
  const StaffProfileScreen({super.key, required this.api, required this.joiner, this.shell, this.as});

  final StaffApi api;
  final OnboardingShell? shell;
  final StaffJoiner joiner;
  final StaffRole? as;

  @override
  State<StaffProfileScreen> createState() => _StaffProfileScreenState();
}

class _StaffProfileScreenState extends State<StaffProfileScreen> with _Reads<StaffProfileScreen, StaffProfile> {
  final _open = <String>{};

  @override
  Future<StaffProfile> read() => widget.api.fetchProfile(widget.joiner.journeyId, as: widget.as);

  @override
  Widget build(BuildContext context) {
    final profile = data;
    final j = widget.joiner;
    return staffPage(
      context,
      shell: widget.shell,
      title: j.name,
      body: profile == null
          ? loading()
          : staffList([
              StaffTaskHead(joiner: j, title: '${j.first}’s profile', line: '${profile.pct}% complete'),
              StaffItems(
                items: [
                  for (final s in profile.sections)
                    StaffItem(
                      key: ValueKey('staff-section-${s.key}'),
                      title: s.title,
                      pill: s.missing > 0 ? '${s.missing} missing' : 'Complete',
                      pillTone: s.missing > 0 ? 'amber' : 'green',
                      open: _open.contains(s.key),
                      onToggle: () => setState(() => _open.contains(s.key) ? _open.remove(s.key) : _open.add(s.key)),
                      body: [StaffItemRows(rows: [for (final r in s.rows) (r.label, r.value ?? 'Not filled yet', r.value == null)])],
                    ),
                ],
              ),
            ]),
    );
  }
}
