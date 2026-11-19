import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart' show onboardingErrorText;
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import 'team_kit.dart';

/// Teams › Joiners for the head of department and the buddy, and the full
/// task list (“View all”) for every viewer: the Team side artifact
/// (8C82Qv57Z88eV7VTVQpFGZ, prototypes HodProto, BuddyProto, MgrAllTasks,
/// HodApprove). Drawn with T1's team kit; data from `/lifecycle/team/…`.

TeamTaskKind teamKindOf(TeamTask t) => TeamTaskKind.values.byName(t.kind.name);

// ─── The rows: what is due now, coming up, ahead or back ────────────────────

/// One row as the list draws it (the prototype's `rows`).
class TeamRowModel {
  TeamRowModel(this.task, {this.head, this.soon = false, this.locked = false, this.pill, this.pillBg, this.pillFg, this.sub});

  final TeamTask task;
  final String? head;
  final bool soon;
  final bool locked;
  final String? pill;
  final Color? pillBg;
  final Color? pillFg;
  final String? sub;
}

String _opensIn(String step) => step == 'Confirmed' ? 'Opens once confirmed' : 'Opens in $step';

/// The list for the step [at] (null: now), as the prototype builds it: now →
/// the step's open tasks, its done ones, then the next step's as COMING UP;
/// ahead → that step's (IN MONTH 2), then what is still open now; back → that step's.
List<TeamRowModel> teamRowsFor(TeamJoinerPage page, {int? at}) {
  final cur = page.step;
  final idx = at ?? cur;
  final steps = page.steps;
  String stepName(int i) => i >= 0 && i < steps.length ? steps[i] : '';
  final rows = <TeamRowModel>[];
  if (idx == cur) {
    final here = page.tasks.where((t) => t.step == cur).toList();
    rows.addAll(here.where((t) => !t.done).map(TeamRowModel.new));
    rows.addAll(here.where((t) => t.done).map(TeamRowModel.new));
    final later = page.tasks.where((t) => t.step > cur).toList();
    if (later.isNotEmpty) {
      final next = later.map((t) => t.step).reduce((a, b) => a < b ? a : b);
      final soon = later.where((t) => t.step == next).toList();
      for (var k = 0; k < soon.length; k++) {
        final t = soon[k];
        rows.add(TeamRowModel(
          t,
          soon: true,
          head: k == 0 ? 'COMING UP' : null,
          locked: !t.early,
          pill: t.early ? stepName(t.step) : null,
          pillBg: OnbColors.screen,
          pillFg: OnbColors.text2,
          sub: t.early ? null : _opensIn(stepName(t.step)),
        ));
      }
    }
  } else if (idx > cur) {
    final there = page.tasks.where((t) => t.step == idx).toList();
    for (var k = 0; k < there.length; k++) {
      final t = there[k];
      rows.add(TeamRowModel(t, head: k == 0 ? 'IN ${stepName(idx).toUpperCase()}' : null, locked: !t.early, sub: t.early ? null : _opensIn(stepName(idx))));
    }
    final open = page.tasks.where((t) => t.step == cur && !t.done).toList();
    for (var k = 0; k < open.length; k++) {
      rows.add(TeamRowModel(open[k], head: k == 0 ? 'NOW · ${stepName(cur).toUpperCase()}' : null));
    }
  } else {
    rows.addAll(page.tasks.where((t) => t.step == idx).map(TeamRowModel.new));
  }
  return rows;
}

/// A review's or approval's pill ("Ready to approve", "Waiting for Sunny", "Approved", "Asked to discuss").
(String, Color, Color)? teamReviewPill(TeamTask t, TeamJoinerPage page) {
  final s = t.reviewState;
  if (s == null) return null;
  final ap = t.isApproval;
  final mgr = (page.managerName ?? '').split(' ').first;
  return switch (s) {
    TeamReviewState.ready => (ap ? 'Ready to approve' : 'Ready to review', TeamColors.blueBg, OnbColors.primary),
    TeamReviewState.waiting => ('Waiting for ${ap ? (mgr.isEmpty ? 'the manager' : mgr) : page.first}', OnbColors.screen, OnbColors.text3),
    TeamReviewState.reviewed => (ap ? 'Approved' : 'Reviewed', TeamColors.okBg, TeamColors.okFg),
    TeamReviewState.back => (ap ? 'Asked to discuss' : 'Sent back', TeamColors.warnBg, TeamColors.warnFg),
  };
}

/// Draws one [TeamRowModel] with T1's [TeamTaskRow].
Widget teamRowWidget(
  TeamRowModel r,
  TeamJoinerPage page, {
  required bool divider,
  required bool busy,
  required VoidCallback onTick,
  required VoidCallback onOpen,
}) {
  final t = r.task;
  final review = r.locked ? null : teamReviewPill(t, page);
  final opens = !r.locked && (t.opens == 'meeting' || (t.opens == 'approval' && t.reviewState != TeamReviewState.waiting));
  final end = r.locked
      ? TeamRowEnd.locked
      : t.isApproval
      ? (t.reviewState == TeamReviewState.waiting ? TeamRowEnd.none : TeamRowEnd.chevron)
      : t.canTick
      ? TeamRowEnd.tick
      : opens
      ? TeamRowEnd.chevron
      : TeamRowEnd.none;
  final sub = r.sub ?? (t.pair == null ? t.note : null);
  return TeamTaskRow(
    key: ValueKey('team-task-${t.id}'),
    kind: teamKindOf(t),
    title: t.title,
    pairName: page.name,
    pairPhotoUrl: page.photoUrl,
    pairLabel: r.sub == null ? t.pair : null,
    sub: sub,
    pill: r.pill ?? review?.$1,
    pillBg: r.pillBg ?? review?.$2 ?? OnbColors.screen,
    pillFg: r.pillFg ?? review?.$3 ?? OnbColors.text2,
    end: end,
    done: t.done,
    strike: !t.isApproval,
    busy: busy,
    onOpen: opens ? onOpen : null,
    onTick: end == TeamRowEnd.tick ? onTick : null,
    divider: divider,
  );
}

// ─── A page's state, shared by the person page and View all ─────────────────

/// One joiner's page for the viewer: loads, ticks (optimistic), and opens a
/// meeting or the approval. Both screens below listen to it.
class TeamJoinerController extends ChangeNotifier {
  TeamJoinerController({required this.api, required this.journeyId, TeamJoinerPage? initial}) : page = initial;

  final TeamJoinersApi api;
  final String journeyId;
  TeamJoinerPage? page;
  Object? error;
  final Set<String> busy = {};

  Future<void> load() async {
    try {
      page = await api.fetchJoiner(journeyId);
      error = null;
    } catch (e) {
      error = e;
    }
    notifyListeners();
  }

  Future<void> tick(BuildContext context, TeamTask t) async {
    final current = page;
    if (current == null || busy.contains(t.id)) return;
    busy.add(t.id);
    page = TeamJoinerPage(
      journeyId: current.journeyId, name: current.name, first: current.first, relation: current.relation, steps: current.steps,
      step: current.step, status: current.status, designation: current.designation, department: current.department,
      photoUrl: current.photoUrl, managerName: current.managerName, buddyName: current.buddyName, plant: current.plant,
      delayed: current.delayed, canBrowseSteps: current.canBrowseSteps, preboarding: current.preboarding,
      tasks: [for (final x in current.tasks) x.id == t.id ? x.copyWith(done: !t.done) : x],
    );
    notifyListeners();
    try {
      page = await api.taskAction(journeyId, t.id, t.done ? 'undo' : 'done');
      if (!t.done && t.kind == TeamKind.meet && context.mounted) showAppToast(context, 'Marked as done');
    } catch (e) {
      page = current;
      if (context.mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      busy.remove(t.id);
      notifyListeners();
    }
  }

  Future<void> open(BuildContext context, TeamTask t) async {
    final p = page;
    if (p == null) return;
    if (t.opens == 'approval') {
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => HodApprovalScreen(api: api, page: p)));
    } else if (t.opens == 'meeting') {
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TeamMeetingAgendaScreen(controller: this, task: t)));
    }
    if (context.mounted) await load();
  }
}

/// The plain page around these screens: a back + title row on the app's grey.
class _TeamPage extends StatelessWidget {
  const _TeamPage({required this.title, required this.children, this.footer});

  final String title;
  final List<Widget> children;
  final Widget? footer;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: OnbColors.screen,
    appBar: AppBar(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      elevation: 0,
      titleSpacing: 0,
      title: Text(title, style: OnbText.screenTitle),
    ),
    body: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 32), children: _gap(children, 14)),
    bottomNavigationBar: footer == null ? null : SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: footer)),
  );
}

List<Widget> _gap(List<Widget> items, double gap) => [
  for (var i = 0; i < items.length; i++) ...[if (i > 0) SizedBox(height: gap), items[i]],
];

// ─── The person page (buddy, head of department) ────────────────────────────

/// A joiner's page for the buddy or the head of department (HodProto,
/// BuddyProto, BuddyPriya, HodProtoSana): who they are, the main card
/// ("Help Priya with" / "Your tasks for Sana") with what is due now, and the
/// two tiles (their onboarding · View progress; Reach out · Choose how).
class TeamJoinerScreen extends StatefulWidget {
  const TeamJoinerScreen({super.key, required this.api, required this.journeyId, this.onOpenProfile, this.onViewProgress, this.reachOutWays});

  final TeamJoinersApi api;
  final String journeyId;
  final void Function(BuildContext context, TeamJoinerPage page)? onOpenProfile;

  /// T1's View progress page, when the shell has it; else the steps page here.
  final void Function(BuildContext context, TeamJoinerPage page)? onViewProgress;

  /// The reach-out ways (T1's blocks); none: the tile opens a message.
  final List<TeamReachOutWay> Function(BuildContext context, TeamJoinerPage page)? reachOutWays;

  @override
  State<TeamJoinerScreen> createState() => _TeamJoinerScreenState();
}

class _TeamJoinerScreenState extends State<TeamJoinerScreen> {
  late final TeamJoinerController _c = TeamJoinerController(api: widget.api, journeyId: widget.journeyId);

  @override
  void initState() {
    super.initState();
    unawaited(_c.load());
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      if (page == null) {
        return _TeamPage(
          title: 'Joiners',
          children: [
            if (_c.error != null)
              Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(onboardingErrorText(_c.error!), style: OnbText.body)))
            else
              const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
          ],
        );
      }
      final rows = teamRowsFor(page);
      var due = rows.where((r) => !r.soon && !r.task.done && !r.locked).toList();
      if (due.isEmpty) due = rows.where((r) => r.soon && !r.locked && !r.task.done).toList();
      final hub = due.take(3).toList();
      final soonFirst = rows.where((r) => r.soon).firstOrNull;
      final delayed = page.delayed > 0;
      return _TeamPage(
        title: 'Joiners',
        children: [
          TeamPersonHero(
            name: page.name,
            photoUrl: page.photoUrl,
            designation: page.designation,
            reportsLine: page.reportsLine,
            buddyLine: page.buddyLine,
            buddyIsYou: page.relation == TeamRelation.buddy,
            stage: page.stepLabel,
            plant: page.plant,
            onOpenProfile: widget.onOpenProfile == null ? null : () => widget.onOpenProfile!(context, page),
          ),
          TeamTasksCard(
            title: page.tasksTitle,
            openCount: page.openNow.length,
            rows: [
              for (var k = 0; k < hub.length; k++)
                teamRowWidget(
                  hub[k],
                  page,
                  divider: k < hub.length - 1,
                  busy: _c.busy.contains(hub[k].task.id),
                  onTick: () => _c.tick(context, hub[k].task),
                  onOpen: () => _c.open(context, hub[k].task),
                ),
            ],
            emptyText: soonFirst == null ? 'Nothing due right now.' : 'Nothing due right now. Next: ${soonFirst.task.title}',
            onViewAll: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TeamAllTasksScreen(controller: _c))),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TeamSmallTile(
                  label: '${page.first}’s onboarding',
                  line: page.status,
                  dot: delayed ? TeamColors.warnFg : TeamColors.okFg,
                  link: 'View progress',
                  onTap: () => widget.onViewProgress != null
                      ? widget.onViewProgress!(context, page)
                      : Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TeamProgressScreen(page: page))),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TeamSmallTile(
                  label: 'Reach out to ${page.first}',
                  line: page.preboarding ? 'Welcome ${page.first} before Day 1' : 'Make ${page.first} feel welcome',
                  link: 'Choose how',
                  linkColor: TeamColors.reachOut,
                  onTap: () => _reachOut(context, page),
                ),
              ),
            ],
          ),
        ],
      );
    },
  );

  void _reachOut(BuildContext context, TeamJoinerPage page) {
    final ways = widget.reachOutWays?.call(context, page) ?? const <TeamReachOutWay>[];
    if (ways.isEmpty) {
      showAppToast(context, 'Opens a chat with ${page.first}');
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _TeamPage(title: page.name, children: [TeamSectionTitle('Reach out to ${page.first}'), TeamReachOutBlocks(ways: ways)]),
      ),
    );
  }
}

// ─── View all: the full task list ───────────────────────────────────────────

/// Every task for the joiner (MgrAllTasks): the steps across the top (tap one
/// to look ahead or back; the head of department only follows along), the
/// list with COMING UP / IN MONTH 2 / NOW heads, ticks and openers.
class TeamAllTasksScreen extends StatefulWidget {
  const TeamAllTasksScreen({super.key, required this.controller});

  final TeamJoinerController controller;

  @override
  State<TeamAllTasksScreen> createState() => _TeamAllTasksScreenState();
}

class _TeamAllTasksScreenState extends State<TeamAllTasksScreen> {
  int? _at;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      final page = c.page!;
      final at = _at;
      final rows = teamRowsFor(page, at: at);
      final mode = at == null || at == page.step ? 'now' : (at > page.step ? 'ahead' : 'back');
      final left = page.openNow.length;
      final meta = mode == 'now' ? (left > 0 ? '$left to do' : 'All done for now') : (mode == 'ahead' ? 'A look ahead' : 'Looking back');
      return _TeamPage(
        title: 'All tasks',
        children: [
          _StepStrip(
            steps: page.steps,
            current: page.step,
            selected: at ?? page.step,
            onPick: page.canBrowseSteps ? (i) => setState(() => _at = i == page.step ? null : i) : null,
          ),
          if (mode != 'now')
            Align(
              alignment: Alignment.centerLeft,
              child: OnbLink(label: 'Back to now', onTap: () => setState(() => _at = null)),
            ),
          TeamSectionTitle(page.tasksTitle, meta: meta),
          if (rows.isEmpty)
            const TeamFootnote('Nothing in this step.')
          else
            TeamListCard(
              children: [
                for (var k = 0; k < rows.length; k++) ...[
                  if (rows[k].head != null) TeamListHead(rows[k].head!),
                  teamRowWidget(
                    rows[k],
                    page,
                    divider: k < rows.length - 1,
                    busy: c.busy.contains(rows[k].task.id),
                    onTick: () => c.tick(context, rows[k].task),
                    onOpen: () => c.open(context, rows[k].task),
                  ),
                ],
              ],
            ),
        ],
      );
    },
  );
}

/// The steps as pills that scroll sideways: the current one blue, done ones green.
class _StepStrip extends StatefulWidget {
  const _StepStrip({required this.steps, required this.current, required this.selected, this.onPick});

  final List<String> steps;
  final int current;
  final int selected;
  final ValueChanged<int>? onPick;

  @override
  State<_StepStrip> createState() => _StepStripState();
}

class _StepStripState extends State<_StepStrip> {
  final _scroll = ScrollController();
  final _keys = <int, GlobalKey>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _keys[widget.current]?.currentContext;
      if (ctx != null) Scrollable.ensureVisible(ctx, alignment: 0.3);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 40,
    child: ListView.separated(
      controller: _scroll,
      scrollDirection: Axis.horizontal,
      itemCount: widget.steps.length,
      separatorBuilder: (_, _) => const SizedBox(width: 6),
      itemBuilder: (context, i) {
        final cur = i == widget.current, done = i < widget.current, sel = i == widget.selected && !cur;
        final bg = cur ? OnbColors.primary : (done ? TeamColors.okBg : Colors.white);
        final fg = cur ? Colors.white : (done ? const Color(0xFF1F9D45) : OnbColors.text3);
        return Semantics(
          key: _keys.putIfAbsent(i, GlobalKey.new),
          button: widget.onPick != null,
          selected: cur,
          label: widget.steps[i],
          child: Material(
            color: bg,
            shape: StadiumBorder(
              side: sel
                  ? const BorderSide(color: OnbColors.primary, width: 2)
                  : (cur || done ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: widget.onPick == null ? null : () => widget.onPick!(i),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Center(
                  child: Text(
                    widget.steps[i],
                    style: TextStyle(fontSize: 12, fontWeight: cur ? FontWeight.w700 : FontWeight.w600, color: fg),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    ),
  );
}

// ─── View progress (when the shell has no richer page) ──────────────────────

class TeamProgressScreen extends StatelessWidget {
  const TeamProgressScreen({super.key, required this.page});

  final TeamJoinerPage page;

  @override
  Widget build(BuildContext context) {
    final delayed = page.delayed > 0;
    return _TeamPage(
      title: page.name,
      children: [
        TeamSectionTitle(
          '${page.first}’s onboarding',
          trailing: TeamPill(
            page.status,
            background: delayed ? TeamColors.warnBg : TeamColors.okBg,
            foreground: delayed ? TeamColors.warnFg : TeamColors.okFg,
            height: 26,
          ),
        ),
        if (delayed) TeamDelayBanner(page.status),
        TeamListCard(
          children: [
            for (var i = 0; i < page.steps.length; i++)
              TeamStatusRow(
                title: page.steps[i],
                status: i < page.step ? 'Done' : (i == page.step ? 'Now' : 'Coming up'),
                bg: i < page.step ? TeamColors.okBg : (i == page.step ? TeamColors.blueBg : OnbColors.screen),
                fg: i < page.step ? TeamColors.okFg : (i == page.step ? OnbColors.primary : OnbColors.text3),
                divider: i < page.steps.length - 1,
              ),
          ],
        ),
        TeamFootnote('You can see where ${page.first} is. Survey answers and meeting notes stay private.'),
      ],
    );
  }
}

// ─── A team meeting (buddy check-ins, the head of department's hello) ───────

/// A meeting from the team list: who with, the agenda, Mark as done. (T1's
/// team_meeting_screen.dart has notes and voice typing for the manager's
/// journey meetings; the team meetings' notes are not stored yet.)
class TeamMeetingAgendaScreen extends StatelessWidget {
  const TeamMeetingAgendaScreen({super.key, required this.controller, required this.task});

  final TeamJoinerController controller;
  final TeamTask task;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final page = controller.page!;
      final t = page.tasks.firstWhere((x) => x.id == task.id, orElse: () => task);
      return _TeamPage(
        title: page.name,
        footer: t.canTick
            ? (t.done
                  ? OnbSecondaryButton(label: 'Done', onTap: () => controller.tick(context, t))
                  : OnbPrimaryButton(label: 'Mark as done', onTap: () => controller.tick(context, t)))
            : null,
        children: [
          OnbCard(
            child: Row(
              children: [
                OnbAvatar(name: page.name, photoUrl: page.photoUrl, size: 52),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.title, style: OnbText.screenTitle),
                      const SizedBox(height: 2),
                      Text('With ${page.name}', style: OnbText.label),
                    ],
                  ),
                ),
                if (t.done) const TeamPill('Done', background: TeamColors.okBg, foreground: Color(0xFF1F9D45), height: 26),
              ],
            ),
          ),
          if (t.agenda.isNotEmpty) ...[
            TeamSectionTitle('Agenda', meta: '${t.agenda.length} things to talk about'),
            for (var i = 0; i < t.agenda.length; i++)
              OnbCard(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      width: 26,
                      height: 26,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: TeamColors.okBg, shape: BoxShape.circle),
                      child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: TeamColors.okFg)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(t.agenda[i], style: OnbText.bodyStrong)),
                  ],
                ),
              ),
          ],
        ],
      );
    },
  );
}

// ─── The head of department's approval ──────────────────────────────────────

/// "today", "yesterday", "2 days ago".
String _ago(DateTime at, DateTime now) {
  final days = DateTime.utc(now.year, now.month, now.day).difference(DateTime.utc(at.year, at.month, at.day)).inDays;
  return days <= 0 ? 'today' : days == 1 ? 'yesterday' : '$days days ago';
}

/// "Dev’s confirmation" (HodApprove): what the manager recommends and why,
/// the facts (self-review, discussion, months reviewed, survey), your
/// comments with voice typing, then Ask to discuss or Approve.
class HodApprovalScreen extends StatefulWidget {
  const HodApprovalScreen({super.key, required this.api, required this.page});

  final TeamJoinersApi api;
  final TeamJoinerPage page;

  @override
  State<HodApprovalScreen> createState() => _HodApprovalScreenState();
}

class _HodApprovalScreenState extends State<HodApprovalScreen> {
  TeamApproval? _a;
  Object? _error;
  bool _sending = false;
  final _comment = TextEditingController();
  final _voice = TeamVoice();

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
      final a = await widget.api.fetchApproval(widget.page.journeyId);
      if (mounted) setState(() => _a = a);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _answer(String action) async {
    if (_sending) return;
    setState(() => _sending = true);
    try {
      await widget.api.answerApproval(widget.page.journeyId, action, comment: _comment.text);
      if (!mounted) return;
      final mgr = (_a?.managerName ?? '').split(' ').first;
      showAppToast(context, action == 'approve' ? 'Confirmation approved' : 'Asked ${mgr.isEmpty ? 'the manager' : mgr} to discuss');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() => _sending = false);
        showAppToast(context, onboardingErrorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = widget.page;
    final a = _a;
    final title = '${page.first}’s confirmation';
    if (a == null) {
      return _TeamPage(
        title: page.name,
        children: [
          if (_error != null)
            Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(onboardingErrorText(_error!), style: OnbText.body)))
          else
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
        ],
      );
    }
    final mgrFirst = (a.recommendedBy ?? a.managerName).split(' ').first;
    final (stateLabel, stateBg, stateFg) = switch (a.state) {
      TeamReviewState.ready => ('Ready to approve', TeamColors.blueBg, OnbColors.primary),
      TeamReviewState.reviewed => ('Approved', TeamColors.okBg, TeamColors.okFg),
      TeamReviewState.back => ('Asked to discuss', TeamColors.warnBg, TeamColors.warnFg),
      TeamReviewState.waiting => ('Waiting', OnbColors.screen, OnbColors.text3),
    };
    final sent = a.recommendedAt == null
        ? 'Waiting for $mgrFirst to recommend'
        : 'Recommended ${_ago(a.recommendedAt!, DateTime.now())} by $mgrFirst';
    final open = a.state == TeamReviewState.ready || a.state == TeamReviewState.back;
    return _TeamPage(
      title: page.name,
      footer: open
          ? Row(
              children: [
                Expanded(flex: 10, child: OnbSecondaryButton(label: 'Ask to discuss', onTap: _sending ? null : () => _answer('discuss'))),
                const SizedBox(width: 10),
                Expanded(flex: 14, child: OnbPrimaryButton(label: 'Approve', busy: _sending, onTap: _sending ? null : () => _answer('approve'))),
              ],
            )
          : null,
      children: [
        OnbCard(
          child: Row(
            children: [
              OnbAvatar(name: page.name, photoUrl: page.photoUrl, size: 52),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: OnbText.screenTitle),
                    const SizedBox(height: 2),
                    Text(sent, style: OnbText.label),
                  ],
                ),
              ),
              TeamPill(stateLabel, background: stateBg, foreground: stateFg, height: 26),
            ],
          ),
        ),
        if (a.recommendedBy != null)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: TeamColors.okBg, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${a.recommendedBy} recommends: ${a.outcome == 'extend' ? 'Extend' : 'Confirm'}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: TeamColors.okFg),
                ),
                if (a.note != null) ...[const SizedBox(height: 6), Text(a.note!, style: OnbText.body.copyWith(color: OnbColors.text, height: 1.5))],
              ],
            ),
          ),
        if (a.facts.isNotEmpty)
          TeamListCard(
            radius: 16,
            children: [
              for (var i = 0; i < a.facts.length; i++)
                Container(
                  constraints: const BoxConstraints(minHeight: 48),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(border: i < a.facts.length - 1 ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
                  child: Row(
                    children: [
                      Expanded(child: Text(a.facts[i].label, style: OnbText.bodyStrong)),
                      Text(
                        a.facts[i].value,
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: a.facts[i].ok ? TeamColors.okFg : OnbColors.text3),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        if (open) ...[
          TeamNotesField(
            field: 'hod-comment',
            controller: _comment,
            voice: _voice,
            label: 'Your comments',
            hint: 'What you’d like ${page.first} to know',
            minLines: 3,
            filled: false,
          ),
          TeamFootnote('$mgrFirst, ${page.first} and HR see your comments.'),
        ] else if (a.answerNote != null)
          OnbCard(child: Text(a.answerNote!, style: OnbText.body)),
      ],
    );
  }
}
