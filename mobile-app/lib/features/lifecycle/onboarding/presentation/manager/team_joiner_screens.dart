import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../profile/profile_launcher.dart';
import '../../data/onboarding_api.dart' show onboardingErrorText;
import '../../data/onboarding_models.dart' show PlantState;
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import 'team_kit.dart';
import 'team_task_screens.dart';

/// Teams › Joiners, a joiner's page (Onboarding · Final designs, canvas page
/// "3 · App · teammates", MgrTeamsProto layout C): the same page for the
/// manager, the buddy and the head of department. Who they are; "Your tasks
/// for Priya" / "Help Priya with" with what is due now; their onboarding
/// (View progress) and Reach out (Choose how). Everything on it is
/// `GET /lifecycle/team/joiners/:id/page`.

// ─── State shared by the page and the screens it opens ──────────────────────

class TeamPageController extends ChangeNotifier {
  TeamPageController({required this.shell, required this.api, required this.journeyId});

  final OnboardingShell shell;
  final TeamJoinersApi api;
  final String journeyId;
  TeamJoinerPage? page;
  Object? error;
  final Set<String> busy = {};
  bool _disposed = false;

  Future<void> load() async {
    try {
      page = await api.fetchPage(journeyId);
      error = null;
    } catch (e) {
      error = e;
    }
    _notify();
  }

  /// A screen answered with the page as it is now.
  void replace(TeamJoinerPage next) {
    page = next;
    _notify();
  }

  /// A tick (optimistic): `done` or `undo`. Throws what went wrong.
  Future<void> tick(TeamTask row, {bool? done}) async {
    final current = page;
    if (current == null || busy.contains(row.id)) return;
    final to = done ?? !row.done;
    busy.add(row.id);
    page = current.withTask(row.copyWith(done: to));
    _notify();
    try {
      page = await api.rowAction(journeyId, row.id, to ? 'done' : 'undo');
    } catch (e) {
      page = current;
      rethrow;
    } finally {
      busy.remove(row.id);
      _notify();
    }
  }

  TeamTask? row(String id) => page?.tasks.where((t) => t.id == id).firstOrNull;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

// ─── Toast ──────────────────────────────────────────────────────────────────

/// The canvas's toast: the message and one button ("OK", or "Add notes" after
/// a meeting is ticked).
void showTeamToast(BuildContext context, String text, {String cta = 'OK', VoidCallback? onCta}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger != null) showTeamToastOn(messenger, text, cta: cta, onCta: onCta);
}

/// The same toast on [messenger] (it outlives a screen that has just closed).
void showTeamToastOn(ScaffoldMessengerState messenger, String text, {String cta = 'OK', VoidCallback? onCta}) {
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        key: const ValueKey('team-toast'),
        backgroundColor: TeamColors.ink,
        behavior: SnackBarBehavior.floating,
        elevation: 6,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        duration: Duration(seconds: onCta == null ? 4 : 5),
        content: Row(
          children: [
            Expanded(child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white))),
            const SizedBox(width: 10),
            TextButton(
              key: const ValueKey('team-toast-cta'),
              style: TextButton.styleFrom(
                backgroundColor: const Color(0x29FFFFFF),
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 36),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              onPressed: () {
                messenger.hideCurrentSnackBar();
                onCta?.call();
              },
              child: Text(cta),
            ),
          ],
        ),
      ),
    );
}

// ─── Rows: what the card and View all list ──────────────────────────────────

TeamTaskKind teamKindOf(String kind) => TeamTaskKind.values.where((k) => k.name == kind).firstOrNull ?? TeamTaskKind.task;

/// A row as the lists draw it, with its section head.
class TeamRowItem {
  const TeamRowItem(this.task, {this.soon = false, this.head});
  final TeamTask task;
  final bool soon;
  final String? head;
}

/// The list "now" (MgrTeamsProto `rows`): this step's tasks, open ones first
/// then done ones (and anything from an earlier step still open), then the
/// next step that has tasks, under COMING UP.
List<TeamRowItem> teamRowsNow(TeamJoinerPage page) {
  final cur = page.joiner.step;
  final here = page.tasks.where((t) => t.step == cur || (t.step < cur && !t.done)).toList();
  final later = page.tasks.where((t) => t.step > cur).toList();
  final nextAt = later.isEmpty ? null : later.map((t) => t.step).reduce((a, b) => a < b ? a : b);
  final soon = nextAt == null ? const <TeamTask>[] : later.where((t) => t.step == nextAt).toList();
  return [
    for (final t in here.where((t) => !t.done)) TeamRowItem(t),
    for (final t in here.where((t) => t.done)) TeamRowItem(t),
    for (final (k, t) in soon.indexed) TeamRowItem(t, soon: true, head: k == 0 ? 'COMING UP' : null),
  ];
}

/// "Opens in Week 1", "Opens once confirmed".
String teamOpensIn(String stepLabel) => stepLabel == 'Confirmed' ? 'Opens once confirmed' : 'Opens in $stepLabel';

(Color, Color) teamPillColors(TeamPillText pill) => switch (pill.tone) {
  TeamTone.blue => (TeamColors.blueBg, OnbColors.primary),
  TeamTone.green || TeamTone.ok => (TeamColors.okBg, TeamColors.okFg),
  TeamTone.amber || TeamTone.warn => (TeamColors.warnBg, TeamColors.warnFg),
  TeamTone.red => (const Color(0xFFFDECE7), const Color(0xFFB23500)),
  _ => (OnbColors.screen, pill.text.startsWith('Waiting') ? OnbColors.text3 : OnbColors.text2),
};

/// Whether a row opens its own screen.
bool teamRowOpens(TeamTask t) => !t.locked && t.opens != null;

/// The row's end: a tick (meetings, plain rows, a tick-only task), a chevron (its own screen), a lock.
TeamRowEnd teamRowEnd(TeamTask t) {
  if (t.locked) return TeamRowEnd.locked;
  if (t.canTick || t.opens == 'groups') return TeamRowEnd.tick;
  if (t.opens != null) return TeamRowEnd.chevron;
  return TeamRowEnd.none;
}

/// One row, as the card and View all draw it.
Widget teamRowWidget(
  BuildContext context,
  TeamRowItem item,
  TeamJoinerPage page, {
  required TeamPageController controller,
  required bool divider,
  bool fromAll = false,
}) {
  final t = item.task;
  final review = t.kind == 'review' || t.kind == 'approve';
  final pill = t.locked ? null : t.pill;
  final colors = pill == null ? null : teamPillColors(pill);
  final sub = t.locked ? teamOpensIn(t.stepLabel) : (t.pair == null ? t.note : null);
  final end = teamRowEnd(t);
  return TeamTaskRow(
    key: ValueKey('team-row-${t.id}'),
    kind: teamKindOf(t.kind),
    title: t.title,
    pairName: page.joiner.name,
    pairPhotoUrl: page.joiner.photoUrl,
    pairLabel: t.locked ? null : t.pair,
    sub: sub,
    pill: pill?.text,
    pillBg: colors?.$1 ?? OnbColors.screen,
    pillFg: colors?.$2 ?? OnbColors.text2,
    end: end,
    done: t.done,
    strike: !review,
    busy: controller.busy.contains(t.id),
    onOpen: teamRowOpens(t) ? () => openTeamTask(context, controller, t, fromAll: fromAll) : null,
    onTick: end == TeamRowEnd.tick ? () => _tickRow(context, controller, t, fromAll: fromAll) : null,
    divider: divider,
  );
}

Future<void> _tickRow(BuildContext context, TeamPageController controller, TeamTask t, {required bool fromAll}) async {
  final wasDone = t.done;
  try {
    await controller.tick(t);
  } catch (e) {
    if (context.mounted) showTeamToast(context, onboardingErrorText(e));
    return;
  }
  if (!wasDone && t.isMeeting && context.mounted) {
    showTeamToast(context, 'Marked as done', cta: 'Add notes', onCta: () {
      final row = controller.row(t.id);
      if (row != null && context.mounted) unawaited(openTeamTask(context, controller, row, fromAll: fromAll));
    });
  }
}

// ─── The page frame ─────────────────────────────────────────────────────────

/// A page on the team side: the app's header, a back + title row, the page and the tabs.
class TeamFrame extends StatelessWidget {
  const TeamFrame({super.key, required this.shell, required this.title, required this.children, this.onBack});

  final OnboardingShell shell;
  final String title;
  final List<Widget> children;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => OnbScaffold(
    shell: shell,
    title: title,
    onBack: onBack,
    body: ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 14), children[i]],
      ],
    ),
  );
}

/// The page while it loads (or what went wrong).
class _Loading extends StatelessWidget {
  const _Loading({required this.shell, required this.controller, required this.title});

  final OnboardingShell shell;
  final TeamPageController controller;
  final String title;

  @override
  Widget build(BuildContext context) => TeamFrame(
    shell: shell,
    title: title,
    children: [OnbLoadState(error: controller.error == null ? null : onboardingErrorText(controller.error!), onRetry: controller.load)],
  );
}

// ─── The person page ────────────────────────────────────────────────────────

/// Opens a joiner's page from Teams › Joiners (or a notification).
Future<void> openTeamJoiner(BuildContext context, {required OnboardingShell shell, required TeamJoinersApi api, required String journeyId}) =>
    Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => TeamPersonScreen(shell: shell, api: api, journeyId: journeyId)));

class TeamPersonScreen extends StatefulWidget {
  const TeamPersonScreen({super.key, required this.shell, required this.api, required this.journeyId});

  final OnboardingShell shell;
  final TeamJoinersApi api;
  final String journeyId;

  @override
  State<TeamPersonScreen> createState() => _TeamPersonScreenState();
}

class _TeamPersonScreenState extends State<TeamPersonScreen> {
  late final TeamPageController _c = TeamPageController(shell: widget.shell, api: widget.api, journeyId: widget.journeyId);

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

  void _openProfile(TeamJoiner j) {
    final id = j.userId;
    if (id != null) openPersonProfile(id);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final page = _c.page;
      if (page == null) return _Loading(shell: widget.shell, controller: _c, title: 'Joiners');
      final j = page.joiner;
      final rows = teamRowsNow(page);
      var due = rows.where((r) => !r.soon && !r.task.done && !r.task.locked).toList();
      if (due.isEmpty) due = rows.where((r) => r.soon && !r.task.locked && !r.task.done).toList();
      final hub = due.take(3).toList();
      final soonFirst = rows.where((r) => r.soon).firstOrNull;
      final profile = j.userId == null ? null : () => _openProfile(j);
      return TeamFrame(
        shell: widget.shell,
        title: 'Joiners',
        children: [
          TeamPersonHero(
            name: j.name,
            photoUrl: j.photoUrl,
            designation: j.designation,
            reportsLine: j.reportsTo == 'you' ? 'Reports to you' : 'Reports to ${j.reportsTo}',
            buddyLine: j.buddy == 'you' ? 'You’re the buddy' : (j.buddy == null ? 'No buddy yet' : 'Buddy: ${j.buddy}'),
            buddyIsYou: j.buddy == 'you',
            stage: j.stepLabel,
            plant: PlantState(stage: j.plantStage),
            onOpenProfile: profile,
          ),
          TeamTasksCard(
            title: page.cardTitle,
            openCount: page.toDo,
            rows: [
              for (final (k, r) in hub.indexed)
                teamRowWidget(context, r, page, controller: _c, divider: k < hub.length - 1),
            ],
            emptyText: soonFirst == null ? 'Nothing due right now.' : 'Nothing due right now. Next: ${soonFirst.task.title}',
            onViewAll: () => Navigator.of(context).push<void>(
              MaterialPageRoute(builder: (_) => TeamAllTasksScreen(shell: widget.shell, controller: _c)),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TeamSmallTile(
                  key: const ValueKey('team-tile-progress'),
                  label: '${j.first}’s onboarding',
                  line: j.statusLabel,
                  dot: j.statusWarn ? TeamColors.warnFg : TeamColors.okFg,
                  link: 'View progress',
                  onTap: () => Navigator.of(context).push<void>(
                    MaterialPageRoute(builder: (_) => TeamProgressScreen(shell: widget.shell, controller: _c)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TeamSmallTile(
                  key: const ValueKey('team-tile-reach'),
                  label: 'Reach out to ${j.first}',
                  line: j.preboarding ? 'Welcome ${j.first} before Day 1' : 'Make ${j.first} feel welcome',
                  link: 'Choose how',
                  linkColor: TeamColors.reachOut,
                  onTap: () => Navigator.of(context).push<void>(
                    MaterialPageRoute(builder: (_) => TeamReachOutScreen(shell: widget.shell, controller: _c)),
                  ),
                ),
              ),
            ],
          ),
        ],
      );
    },
  );
}

// ─── View all ───────────────────────────────────────────────────────────────

/// MgrAllTasks: every task for the joiner now, done ones after, then COMING UP.
class TeamAllTasksScreen extends StatelessWidget {
  const TeamAllTasksScreen({super.key, required this.shell, required this.controller});

  final OnboardingShell shell;
  final TeamPageController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final page = controller.page;
      if (page == null) return _Loading(shell: shell, controller: controller, title: 'Joiners');
      final rows = teamRowsNow(page);
      return TeamFrame(
        shell: shell,
        title: page.joiner.name,
        children: [
          TeamSectionTitle(page.cardTitle, meta: page.toDo > 0 ? '${page.toDo} to do' : 'All done for now'),
          if (rows.isNotEmpty)
            TeamListCard(
              children: [
                for (final (k, r) in rows.indexed) ...[
                  if (r.head != null) TeamListHead(r.head!),
                  teamRowWidget(
                    context,
                    r,
                    page,
                    controller: controller,
                    divider: k < rows.length - 1 && rows[k + 1].head == null,
                    fromAll: true,
                  ),
                ],
              ],
            ),
        ],
      );
    },
  );
}

// ─── View progress ──────────────────────────────────────────────────────────

const _statBar = {
  'meet': Color(0xFF15803D),
  'ci': Color(0xFF0571A6),
  'tasks': Color(0xFF6B4FBB),
  'watch': Color(0xFF0571A6),
  'tour': Color(0xFFB23500),
  'dev': Color(0xFF2563EB),
  'prof': Color(0xFFB45309),
};

(Color, Color) _toneColors(TeamTone tone) => switch (tone) {
  TeamTone.ok || TeamTone.green => (TeamColors.okBg, TeamColors.okFg),
  TeamTone.warn || TeamTone.amber => (TeamColors.warnBg, TeamColors.warnFg),
  TeamTone.soon => (OnbColors.screen, OnbColors.text3),
  _ => (OnbColors.screen, OnbColors.text2),
};

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "1 Dec" from YYYY-MM-DD.
String teamDayMonth(String ymd) {
  final d = DateTime.tryParse(ymd);
  return d == null ? ymd : '${d.day} ${_months[d.month - 1]}';
}

/// MgrProgress: "Priya’s onboarding", DELAYED, the numbers (each opens its
/// list), JOINING DETAILS before Day 1, and the privacy line.
class TeamProgressScreen extends StatelessWidget {
  const TeamProgressScreen({super.key, required this.shell, required this.controller});

  final OnboardingShell shell;
  final TeamPageController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final page = controller.page;
      if (page == null) return _Loading(shell: shell, controller: controller, title: 'Joiners');
      final j = page.joiner;
      final joining = page.joiningOn == null
          ? null
          : ['Joins ${teamDayMonth(page.joiningOn!)}', ?reportingClock(page.joiningTime), ?page.joiningPlace].join(' · ');
      return TeamFrame(
        shell: shell,
        title: j.name,
        children: [
          TeamSectionTitle('${j.first}’s onboarding', meta: j.statusLabel),
          if (j.statusWarn && j.delayedTitle != null)
            TeamDelayBanner(
              '${j.delayedTitle}, waiting ${j.delayedDays} day${j.delayedDays == 1 ? '' : 's'} on ${j.delayedOwner ?? ''}'.trim(),
            ),
          if (page.stats.isNotEmpty)
            TeamListCard(
              children: [
                for (final (k, s) in page.stats.indexed)
                  Builder(
                    builder: (context) {
                      final (bg, fg) = _toneColors(s.flagTone);
                      return TeamStatRow(
                        key: ValueKey('team-stat-${s.key}'),
                        title: s.title,
                        value: s.key == 'prof' ? '${s.done}%' : '${s.done}/${s.total}',
                        meta: s.unit,
                        fraction: s.total == 0 ? 0 : s.done / s.total,
                        bar: _statBar[s.key] ?? OnbColors.primary,
                        flag: s.flag,
                        flagBg: bg,
                        flagFg: fg,
                        divider: k < page.stats.length - 1,
                        onTap: () => Navigator.of(context).pushReplacement<void, void>(
                          MaterialPageRoute(builder: (_) => TeamProgressListScreen(shell: shell, controller: controller, listKey: s.key)),
                        ),
                      );
                    },
                  ),
              ],
            ),
          if (joining != null)
            Container(
              key: const ValueKey('team-joining-details'),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('JOINING DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
                  const SizedBox(height: 4),
                  Text(joining, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
                ],
              ),
            ),
          TeamFootnote('You can see where ${j.first} is. Meeting notes stay private.'),
        ],
      );
    },
  );
}

/// One of the progress lists (Meetings, Tasks …): now, then COMING UP. Back
/// goes to the person page, as on the canvas.
class TeamProgressListScreen extends StatelessWidget {
  const TeamProgressListScreen({super.key, required this.shell, required this.controller, required this.listKey});

  final OnboardingShell shell;
  final TeamPageController controller;

  /// meet | tasks | ci | watch | tour | dev | prof.
  final String listKey;

  static const titles = {
    'meet': 'Meetings',
    'tasks': 'Tasks',
    'ci': 'Check-ins',
    'dev': 'Devices and accesses',
    'prof': 'Profile',
    'tour': 'Sowaka tour',
    'watch': 'Watch list',
  };

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final page = controller.page;
      if (page == null) return _Loading(shell: shell, controller: controller, title: 'Joiners');
      final first = page.joiner.first;
      final all = page.lists[listKey] ?? const <TeamProgressListRow>[];
      final now = all.where((r) => !r.comingUp).toList();
      final later = all.where((r) => r.comingUp).toList();
      final stat = page.stats.where((s) => s.key == listKey).firstOrNull;
      final meta = stat == null
          ? null
          : switch (listKey) {
              'meet' => '${stat.done} of ${stat.total} met',
              'tasks' => stat.total - stat.done > 0 ? '${stat.total - stat.done} to do' : 'All done',
              _ => null,
            };
      final note = switch (listKey) {
        'meet' => 'Meeting notes stay private to $first.',
        'dev' => 'IT and admin tick these off as they set them up.',
        'prof' => 'HR checks the profile. You see only the progress.',
        _ => null,
      };
      final rows = [...now.map((r) => (r, r.meta)), ...later.map((r) => (r, r.meta ?? r.status))];
      return TeamFrame(
        shell: shell,
        title: page.joiner.name,
        children: [
          TeamSectionTitle(titles[listKey] ?? '', meta: meta),
          if (rows.isNotEmpty)
            TeamListCard(
              children: [
                for (final (k, (r, m)) in rows.indexed) ...[
                  if (k == now.length && later.isNotEmpty) const TeamListHead('COMING UP'),
                  Builder(
                    builder: (context) {
                      final (bg, fg) = _toneColors(r.tone);
                      return TeamStatusRow(title: r.title, meta: m, status: r.status, bg: bg, fg: fg, divider: k < rows.length - 1);
                    },
                  ),
                ],
              ],
            ),
          if (note != null) TeamFootnote(note),
        ],
      );
    },
  );
}

// ─── Reach out ──────────────────────────────────────────────────────────────

/// MgrReachOut: the ways, as blocks (before Day 1: a welcome message and an
/// announcement; after: the feed, a game, an announcement, the team, a message).
class TeamReachOutScreen extends StatelessWidget {
  const TeamReachOutScreen({super.key, required this.shell, required this.controller});

  final OnboardingShell shell;
  final TeamPageController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final page = controller.page;
      if (page == null) return _Loading(shell: shell, controller: controller, title: 'Joiners');
      final ways = [for (final key in page.reachOut) ?_way(context, page, key)];
      return TeamFrame(
        shell: shell,
        title: page.joiner.name,
        children: [
          TeamSectionTitle('Reach out to ${page.joiner.first}'),
          TeamReachOutBlocks(ways: ways),
        ],
      );
    },
  );

  TeamReachOutWay? _way(BuildContext context, TeamJoinerPage page, String key) {
    final j = page.joiner;
    TeamTask? mine(String opens) => page.tasks.where((t) => t.opens == opens).firstOrNull;
    void composer() => TeamReachOutDoors.openComposer?.call(context);
    void chat() {
      final id = j.userId;
      if (id == null) return;
      final open = TeamReachOutDoors.openChat;
      if (open != null) {
        open(context, id);
      } else {
        openPersonProfile(id);
      }
    }

    void task(TeamTask? row, VoidCallback otherwise) {
      if (row != null) {
        unawaited(openTeamTask(context, controller, row));
      } else {
        otherwise();
      }
    }

    return switch (key) {
      'welcome_message' => TeamReachOutWay(
        key: 'welcome_message',
        title: 'Send a welcome message',
        meta: 'A note before Day 1',
        icon: TeamTaskKind.chat.icon,
        tint: TeamTaskKind.chat.tint,
        fg: TeamTaskKind.chat.fg,
        onTap: () => task(mine('chat'), chat),
      ),
      'announcement' => TeamReachOutWay(
        key: 'announcement',
        title: 'Make an announcement',
        meta: j.preboarding ? 'Tell everyone who’s joining' : 'Share the news with everyone',
        icon: Icons.campaign_outlined,
        tint: TeamColors.warnBg,
        fg: TeamColors.warnFg,
        onTap: composer,
      ),
      'feed' => TeamReachOutWay(
        key: 'feed',
        title: 'Welcome on the feed',
        meta: 'A post everyone can cheer',
        icon: Icons.article_outlined,
        tint: TeamTaskKind.goal.tint,
        fg: TeamTaskKind.goal.fg,
        onTap: () => task(mine('feed'), composer),
      ),
      'game' => TeamReachOutWay(
        key: 'game',
        title: 'Send a game',
        meta: 'A quick one to break the ice',
        icon: Icons.sports_esports_outlined,
        tint: TeamTaskKind.team.tint,
        fg: TeamTaskKind.team.fg,
        onTap: () => TeamReachOutDoors.openGames?.call(context),
      ),
      'team_post' => TeamReachOutWay(
        key: 'team_post',
        title: 'Introduce to the team',
        meta: 'A post for your team',
        icon: TeamTaskKind.team.icon,
        tint: TeamColors.okBg,
        fg: TeamColors.okFg,
        onTap: composer,
      ),
      'chat' => TeamReachOutWay(
        key: 'chat',
        title: 'Message',
        meta: 'Just say hi',
        icon: TeamTaskKind.chat.icon,
        tint: TeamTaskKind.chat.tint,
        fg: TeamTaskKind.chat.fg,
        onTap: chat,
      ),
      _ => null,
    };
  }
}

/// The template's reporting time ('HH:mm') as the canvas writes it, "9:30 AM"; older free text as it is.
String? reportingClock(String? hm) {
  if (hm == null) return null;
  final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(hm);
  if (m == null) return hm;
  final h = int.parse(m.group(1)!);
  return '${h % 12 == 0 ? 12 : h % 12}:${m.group(2)} ${h < 12 ? 'AM' : 'PM'}';
}
