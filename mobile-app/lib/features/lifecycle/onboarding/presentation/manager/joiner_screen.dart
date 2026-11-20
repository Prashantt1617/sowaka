import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../profile/profile_launcher.dart';
import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../../data/team_joiners_api.dart';
import '../onboarding_kit.dart';
import 'joiner_setup_screen.dart';
import 'manager_review_screen.dart';
import 'probation_review_screen.dart';
import 'team_kit.dart';
import 'team_meeting_screen.dart';
import 'team_progress.dart';
import 'team_side_screens.dart';

/// The page a joiner's own sub-pages open on (Teams › Joiners, layout C).
enum JoinerPage {
  /// Who they are, your tasks for them, their onboarding and reach out.
  main,

  /// View all: every task, with what is coming up below.
  tasks,

  /// View progress: their onboarding, read-only.
  progress,

  /// Choose how: the ways to reach out, as blocks.
  reachOut,

  /// From View progress: their meetings, their own tasks, the tour, their devices.
  theirMeetings,
  theirTasks,
  theirTour,
  theirDevices,
}

/// A joiner as their manager sees them (Teams › Joiners, artifact
/// 8C82Qv57Z88eV7VTVQpFGZ, MgrTeamsProto, layout C): who they are at the
/// top, "Your tasks for Priya" as the main card with what is due now ready
/// to tick, and two smaller tiles — their onboarding (View progress) and
/// Reach out (Choose how). The tasks and the progress are the team page
/// (`/lifecycle/team/joiners/:id`, the same page the buddy and the head of
/// department read); who they are, their set-up and the probation months
/// come from the manager's joiner (`/lifecycle/manager/joiners/:id`).
/// A meeting opens its agenda and notes, a self check-in its review.
class JoinerScreen extends StatefulWidget {
  const JoinerScreen({super.key, required this.shell, required this.journeyId, this.openSetup = false, this.summary, this.page = JoinerPage.main, this.teamApi});

  final OnboardingShell shell;
  final String journeyId;

  /// The Team tab's row for this joiner: the card paints from it at once.
  final JoinerSummary? summary;

  /// Opens the set-up straight away (from the "set up your joiner" push).
  final bool openSetup;

  /// Where it opens (the artifact's key screens open on their sub-page).
  final JoinerPage page;

  /// The team side's calls; the shell's server otherwise (tests hand a fake).
  final TeamJoinersApi? teamApi;

  @override
  State<JoinerScreen> createState() => _JoinerScreenState();
}

class _JoinerScreenState extends State<JoinerScreen> {
  JoinerDetail? _detail;
  String? _error;
  bool _openedSetup = false;
  late JoinerPage _page = widget.page;
  late final TeamJoinersApi? _teamApi = widget.teamApi ?? HttpTeamJoinersApi.from(_shell.api);
  late final TeamJoinerController? _team = _teamApi == null ? null : TeamJoinerController(api: _teamApi, journeyId: widget.journeyId);

  /// Where Back goes from a page opened from View progress.
  JoinerPage get _parent => switch (_page) {
    JoinerPage.theirMeetings || JoinerPage.theirTasks || JoinerPage.theirTour || JoinerPage.theirDevices => JoinerPage.progress,
    _ => JoinerPage.main,
  };

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _team?.addListener(_onTeam);
    unawaited(_first());
  }

  @override
  void dispose() {
    _team?.removeListener(_onTeam);
    _team?.dispose();
    super.dispose();
  }

  void _onTeam() {
    if (mounted) setState(() {});
  }

  /// Last time's page from the device at once (or the Team tab's row), then live.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchJoiner(widget.journeyId));
    if (kept != null && mounted && _detail == null) setState(() => _detail = kept);
    await _load();
  }

  Future<void> _load() async {
    await Future.wait([_loadDetail(), if (_team != null) _team.load()]);
  }

  Future<void> _loadDetail() async {
    try {
      final detail = await _shell.api.fetchJoiner(widget.journeyId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _error = null;
      });
      if (widget.openSetup && !_openedSetup) {
        _openedSetup = true;
        await _setup(detail);
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _push(Widget page) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
    if (mounted) await _load();
  }

  Future<void> _setup(JoinerDetail detail) =>
      _push(JoinerSetupScreen(shell: _shell, journeyId: widget.journeyId, detail: detail));

  Future<void> _assign(JoinerDetail detail) async {
    final sent = await showStarterTaskSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (sent == true && mounted) {
      showAppToast(context, 'Sent to ${detail.joiner.firstName}');
      await _load();
    }
  }

  Future<void> _note(JoinerDetail detail) async {
    final saved = await showOneOnOneNoteSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (saved == true && mounted) await _load();
  }

  Future<void> _welcome(JoinerDetail detail) async {
    if (!detail.welcomeCanPost) {
      showAppToast(context, detail.welcomePostedAt != null ? 'You already welcomed ${detail.joiner.firstName} on the feed' : 'Post a welcome once ${detail.joiner.firstName} has joined');
      return;
    }
    final sent = await showWelcomePostSheet(context, _shell, widget.journeyId, detail.joiner.firstName);
    if (sent == true && mounted) {
      showAppToast(context, 'Posted on Connect');
      await _load();
    }
  }

  /// A row's screen: a meeting (agenda, notes, Mark as done), a month's self
  /// check-in (the review), the recommendation, or the template step's own
  /// screen (set up, the buddy, goals, the starter task, 1:1 notes).
  Future<void> _openTask(TeamTask t, {bool fromAll = false}) async {
    final detail = _detail;
    final page = _team?.page;
    final api = _teamApi;
    if (detail == null || page == null || api == null) return;
    final bar = fromAll ? 'All tasks' : null;
    switch (t.opens) {
      case 'meeting':
        await _push(
          TeamMeetingScreen(
            key: ValueKey('meeting-${t.id}'),
            shell: _shell,
            title: t.title,
            joinerName: page.name,
            joinerPhotoUrl: page.photoUrl,
            agenda: t.agenda,
            done: t.done,
            canTick: t.canTick,
            barTitle: bar,
            onFinish: (notes, markDone) async {
              if (t.systemKey == 'monthly_checkin' && markDone) {
                // The month's check-in: the notes are the manager's side of it.
                await api.meetingDone(widget.journeyId, t.id, notes: notes);
                return;
              }
              // Notes from a meeting: a private 1:1 note (the manager and HR see it).
              if (notes.isNotEmpty) await _shell.api.addNote(widget.journeyId, '${t.title}\n$notes', shared: false);
              if (markDone) await api.taskAction(widget.journeyId, t.id, 'done');
            },
          ),
        );
      case 'review':
        await _push(ManagerReviewScreen(shell: _shell, teamApi: api, journeyId: widget.journeyId, month: t.month ?? 1, title: t.title, barTitle: bar));
      case 'recommend':
        await _push(RecommendScreen(api: api, page: page, task: t));
      case 'screen':
        switch (t.systemKey) {
          case 'starter_task':
            await _assign(detail);
          case 'one_on_one_notes':
          case 'manager_30day_note':
            await _note(detail);
          case 'monthly_goals':
            final month = t.month ?? 1;
            await _push(
              ProbationReviewScreen(
                shell: _shell,
                journeyId: widget.journeyId,
                month: month,
                initial: detail.probation?.months.where((m) => m.monthNo == month).firstOrNull,
                joinerName: detail.joiner.name,
              ),
            );
          default:
            await _setup(detail);
        }
    }
  }

  void _openProfile(JoinerSummary joiner) {
    final id = joiner.userId;
    if (id == null || !openPersonProfile(id)) {
      showAppToast(context, '${joiner.firstName}’s profile opens once they have joined');
    }
  }

  void _go(JoinerPage page) => setState(() => _page = page);

  void _back() {
    if (_page == JoinerPage.main || _page == widget.page && widget.page != JoinerPage.main) {
      Navigator.of(context).maybePop();
    } else {
      _go(_parent);
    }
  }

  /// "Joiners" on the person page; their name on every page it opens (as drawn).
  String _title(JoinerSummary? joiner) => _page == JoinerPage.main ? 'Joiners' : (joiner?.name ?? 'New joiner');

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final summary = widget.summary;
    return PopScope(
      canPop: _page == JoinerPage.main || _page == widget.page,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _go(_parent);
      },
      child: OnbScaffold(
        shell: _shell,
        title: _title(detail?.joiner ?? summary),
        onBack: _back,
        offline: detail != null && _error != null,
        body: detail != null
            ? RefreshIndicator(onRefresh: _load, child: _body(detail))
            : summary != null && _error == null
            // The top from the Team tab's row while the page loads: never a blank page.
            ? ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                children: [
                  _hero(summary, null, _shell.now()),
                  const SizedBox(height: 24),
                  const _Loading(),
                ],
              )
            : OnbLoadState(error: _error, onRetry: _load),
      ),
    );
  }

  /// Who they are: photo, name, designation, reports to you, their buddy, the stage.
  Widget _hero(JoinerSummary joiner, JoinerDetail? detail, DateTime now) {
    final buddy = detail?.setup.buddy?.name;
    final page = _team?.page;
    return KeyedSubtree(
      key: const ValueKey('mgr-hero'),
      child: TeamPersonHero(
        name: joiner.name,
        photoUrl: joiner.photoUrl,
        designation: joiner.designation,
        reportsLine: 'Reports to you',
        buddyLine: detail == null ? '' : (buddy == null || buddy.isEmpty ? 'No buddy yet' : 'Buddy: $buddy'),
        // The step the team page names (Joins 22 Dec, Day 1, Week 1, Month 2); the row's until it loads.
        stage: page == null ? teamStageLabel(joiner, now) : (page.step == 0 && page.tj != null ? 'Joins ${_joinsDay(page.tj!)}' : page.stepLabel),
        plant: teamPlantOf(joiner),
        onOpenProfile: () => _openProfile(joiner),
      ),
    );
  }

  static String _joinsDay(DateTime tj) => onbDay(tj).split(' ').skip(1).join(' ');

  Widget _body(JoinerDetail detail) {
    final now = _shell.now();
    final page = _team?.page;
    final children = switch (_page) {
      JoinerPage.main => _main(detail, page, now),
      JoinerPage.reachOut => _reachOut(detail),
      _ when page == null => [if (_team != null) _Loading(error: _team.error)],
      JoinerPage.tasks => _allTasks(page),
      JoinerPage.progress => teamProgressPage(page, onOpen: (list) => _go(_pageOf(list))),
      JoinerPage.theirMeetings => teamProgressList(page, TeamProgressList.meetings),
      JoinerPage.theirTasks => teamProgressList(page, TeamProgressList.tasks),
      JoinerPage.theirTour => teamProgressList(page, TeamProgressList.tour),
      JoinerPage.theirDevices => teamProgressList(page, TeamProgressList.devices),
    };
    return ListView(
      key: ValueKey('joiner-page-${_page.name}'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (final (i, c) in children.indexed) ...[if (i > 0) const SizedBox(height: 14), c],
      ],
    );
  }

  static JoinerPage _pageOf(TeamProgressList list) => switch (list) {
    TeamProgressList.meetings => JoinerPage.theirMeetings,
    TeamProgressList.tasks => JoinerPage.theirTasks,
    TeamProgressList.tour => JoinerPage.theirTour,
    TeamProgressList.devices => JoinerPage.theirDevices,
  };

  // ─── The person page ──────────────────────────────────────────────────────

  Widget _row(TeamRowModel r, TeamJoinerPage page, {required bool divider, bool fromAll = false}) => teamRowWidget(
    r,
    page,
    divider: divider,
    busy: _team!.busy.contains(r.task.id),
    onTick: () => _team.tick(context, r.task),
    onOpen: () => _openTask(r.task, fromAll: fromAll),
  );

  List<Widget> _main(JoinerDetail detail, TeamJoinerPage? page, DateTime now) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final Widget card;
    if (page == null) {
      card = _team == null
          ? TeamTasksCard(title: 'Your tasks for $first', openCount: 0, rows: const [], onViewAll: () => _go(JoinerPage.tasks))
          : _Loading(error: _team.error);
    } else {
      // What is due now, up to three; nothing due → the next ones that can be done early.
      final rows = teamRowsFor(page);
      var due = rows.where((r) => !r.soon && !r.task.done && !r.locked && !r.task.locked).toList();
      if (due.isEmpty) due = rows.where((r) => r.soon && !r.locked && !r.task.done).toList();
      final hub = due.take(3).toList();
      final next = rows.where((r) => r.soon).firstOrNull;
      card = TeamTasksCard(
        title: page.tasksTitle,
        openCount: page.openNow.length,
        rows: [for (final (k, r) in hub.indexed) _row(r, page, divider: k < hub.length - 1)],
        emptyText: next == null ? 'Nothing due right now.' : 'Nothing due right now. Next: ${next.task.title}',
        onViewAll: () => _go(JoinerPage.tasks),
      );
    }
    final delayed = (page?.delayed ?? 0) > 0;
    return [
      _hero(joiner, detail, now),
      card,
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TeamSmallTile(
              key: const ValueKey('tile-onboarding'),
              label: '$first’s onboarding',
              dot: delayed ? TeamColors.warnFg : TeamColors.okFg,
              // The team page's status ("On track", "Joining soon", "1 task delayed"), as everyone connected sees it.
              line: page?.status ?? '',
              link: 'View progress',
              onTap: () => _go(JoinerPage.progress),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TeamSmallTile(
              key: const ValueKey('tile-reach-out'),
              label: 'Reach out to $first',
              line: joiner.preboarding ? 'Welcome $first before Day 1' : 'Make $first feel welcome',
              link: 'Choose how',
              linkColor: TeamColors.reachOut,
              onTap: () => _go(JoinerPage.reachOut),
            ),
          ),
        ],
      ),
    ];
  }

  // ─── View all ─────────────────────────────────────────────────────────────

  /// Every task for them now (open, then done), then the next step's as COMING UP.
  List<Widget> _allTasks(TeamJoinerPage page) {
    final rows = teamRowsFor(page);
    final left = page.openNow.length;
    return [
      TeamSectionTitle(page.tasksTitle, meta: left > 0 ? '$left to do' : 'All done for now'),
      if (rows.isEmpty)
        const TeamFootnote('Nothing waiting on you.')
      else
        TeamListCard(
          radius: 16,
          children: [
            for (final (k, r) in rows.indexed) ...[
              if (r.head != null) TeamListHead(r.head!),
              _row(r, page, divider: k < rows.length - 1 && rows[k + 1].head == null, fromAll: true),
            ],
          ],
        ),
    ];
  }

  // ─── Reach out ────────────────────────────────────────────────────────────

  List<Widget> _reachOut(JoinerDetail detail) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    void composer() {
      final open = TeamReachOutDoors.openComposer;
      if (open != null) {
        open(context);
      } else {
        showAppToast(context, 'Opens a post on Connect');
      }
    }

    void chat() {
      final open = TeamReachOutDoors.openChat;
      final id = joiner.userId;
      if (open != null && id != null) {
        open(context, id);
      } else {
        _openProfile(joiner);
      }
    }

    final ways = joiner.preboarding
        ? [
            TeamReachOutWay(
              key: 'welcome-message',
              title: 'Send a welcome message',
              meta: 'A note before Day 1',
              icon: TeamTaskKind.chat.icon,
              tint: TeamTaskKind.chat.tint,
              fg: TeamTaskKind.chat.fg,
              onTap: () => _setup(detail),
            ),
            TeamReachOutWay(
              key: 'announce',
              title: 'Make an announcement',
              meta: 'Tell everyone who’s joining',
              icon: Icons.campaign_outlined,
              tint: TeamColors.warnBg,
              fg: TeamColors.warnFg,
              onTap: composer,
            ),
          ]
        : [
            TeamReachOutWay(
              key: 'feed',
              title: 'Welcome on the feed',
              meta: 'A post everyone can cheer',
              icon: Icons.article_outlined,
              tint: TeamTaskKind.goal.tint,
              fg: TeamTaskKind.goal.fg,
              onTap: () => _welcome(detail),
            ),
            TeamReachOutWay(
              key: 'game',
              title: 'Send a game',
              meta: 'A quick one to break the ice',
              icon: Icons.sports_esports_outlined,
              tint: TeamTaskKind.team.tint,
              fg: TeamTaskKind.team.fg,
              onTap: () {
                final open = TeamReachOutDoors.openGames;
                if (open != null) {
                  open(context);
                } else {
                  showAppToast(context, 'Pick a game to challenge $first');
                }
              },
            ),
            TeamReachOutWay(
              key: 'announce',
              title: 'Make an announcement',
              meta: 'Share the news with everyone',
              icon: Icons.campaign_outlined,
              tint: TeamColors.warnBg,
              fg: TeamColors.warnFg,
              onTap: composer,
            ),
            TeamReachOutWay(
              key: 'introduce',
              title: 'Introduce to the team',
              meta: 'A post for your team',
              icon: TeamTaskKind.team.icon,
              tint: TeamColors.okBg,
              fg: TeamColors.okFg,
              onTap: composer,
            ),
            TeamReachOutWay(
              key: 'message',
              title: 'Message',
              meta: 'Just say hi',
              icon: TeamTaskKind.chat.icon,
              tint: TeamTaskKind.chat.tint,
              fg: TeamTaskKind.chat.fg,
              onTap: chat,
            ),
          ];
    return [
      Text('Reach out to $first', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: TeamColors.ink)),
      TeamReachOutBlocks(ways: ways),
    ];
  }
}


/// A small spinner (or what went wrong) while the team page loads.
class _Loading extends StatelessWidget {
  const _Loading({this.error});

  final Object? error;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 18),
    child: Center(
      child: error != null
          ? Text(onboardingErrorText(error!), style: OnbText.body, textAlign: TextAlign.center)
          : const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
    ),
  );
}

/// "4 PM", "11:30 AM": the pill's time, as the design writes it.
String compactTime(DateTime at) {
  final full = onbTime(at);
  return full.replaceFirst(':00 ', ' ');
}

/// The survey's name on the joiner's page.
String surveyKindName(String kind) => switch (kind) {
  'm3' => 'month-3 pulse survey',
  'm6' => 'month-6 pulse survey',
  _ => 'first-week survey',
};

// ─── M2a · starter task sheet ───────────────────────────────────────────────

/// M2a: a task, when it is due (this Friday, next Monday, or a date picked)
/// and an optional note. Assign → the joiner's Up next with a push. True
/// once sent.
Future<bool?> showStarterTaskSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(
      context,
      builder: (_) => _StarterTaskSheet(shell: shell, journeyId: journeyId, firstName: firstName),
    );

/// The due dates the sheet offers: the coming Friday and the Monday after
/// it (or the next ones, when today is already past them).
(DateTime friday, DateTime monday) starterDueChoices(DateTime now) {
  final today = dateOnly(now);
  var friday = today;
  while (friday.weekday != DateTime.friday || !friday.isAfter(today)) {
    friday = friday.add(const Duration(days: 1));
  }
  var monday = friday;
  while (monday.weekday != DateTime.monday) {
    monday = monday.add(const Duration(days: 1));
  }
  return (friday, monday);
}

class _StarterTaskSheet extends StatefulWidget {
  const _StarterTaskSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_StarterTaskSheet> createState() => _StarterTaskSheetState();
}

class _StarterTaskSheetState extends State<_StarterTaskSheet> {
  final _title = TextEditingController();
  final _note = TextEditingController();
  final _link = TextEditingController();
  DateTime? _due;
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    _link.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final now = widget.shell.now();
    final day = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 3)),
      firstDate: dateOnly(now),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (day != null && mounted) setState(() => _due = day);
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.assignStarterTask(
        widget.journeyId,
        title: _title.text.trim(),
        note: _note.text,
        links: [if (_link.text.trim().isNotEmpty) _link.text.trim()],
        dueAt: _due,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final (friday, monday) = starterDueChoices(widget.shell.now());
    bool same(DateTime? a, DateTime b) => a != null && dateOnly(a) == dateOnly(b);
    final picked = _due != null && !same(_due, friday) && !same(_due, monday);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Give ${widget.firstName} a starter task', style: _SheetText.title),
          const SizedBox(height: 4),
          Text('Something small ${widget.firstName} can finish this week.', style: _SheetText.sub),
          const SizedBox(height: 16),
          const Text('Task', style: _SheetText.label),
          const SizedBox(height: 6),
          OnbTextArea(
            fieldKey: const ValueKey('starter-title'),
            controller: _title,
            hint: 'Redesign the leave request screen',
            minLines: 1,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 14),
          const Text('Due', style: _SheetText.label),
          const SizedBox(height: 6),
          Semantics(
            label: 'Due date',
            child: Row(
              children: [
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-friday'),
                    label: onbDay(friday),
                    selected: same(_due, friday),
                    onTap: () => setState(() => _due = friday),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-monday'),
                    label: onbDay(monday),
                    selected: same(_due, monday),
                    onTap: () => setState(() => _due = monday),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _DueButton(
                    key: const ValueKey('due-pick'),
                    label: picked ? onbDay(_due!) : 'Pick a date',
                    selected: picked,
                    onTap: _pick,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text('Note for ${widget.firstName} (optional)', style: _SheetText.label),
          const SizedBox(height: 6),
          OnbTextArea(controller: _note, hint: 'Start with the research notes in the shared folder.', minLines: 2),
          const SizedBox(height: 10),
          OnbTextArea(controller: _link, hint: 'A link (optional)', minLines: 1),
          const SizedBox(height: 16),
          OnbPrimaryButton(
            key: const ValueKey('starter-assign'),
            label: 'Assign task',
            busy: _busy,
            onTap: _title.text.trim().isEmpty || _due == null ? null : _send,
          ),
        ],
      ),
    );
  }
}

/// M2a's due choice: one of three equal buttons, the chosen one outlined blue.
class _DueButton extends StatelessWidget {
  const _DueButton({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: Material(
      color: selected ? OnbColors.tint : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? OnbColors.primary : OnbColors.line, width: selected ? 2 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: SizedBox(
          height: 44,
          child: Center(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: selected ? OnbColors.primary : OnbColors.text),
            ),
          ),
        ),
      ),
    ),
  );
}

/// The manager's sheets (M2a, M2b), as drawn: a 22 title, a grey line, small labels.
abstract final class _SheetText {
  static const title = TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.25, color: OnbColors.text);
  static const sub = TextStyle(fontSize: 13, height: 1.4, color: OnbColors.text3);
  static const label = TextStyle(fontSize: 12, height: 1.3, color: OnbColors.text2);
}

// ─── M2b · 1:1 notes sheet ──────────────────────────────────────────────────

/// M2b: notes from the 1:1, private to the manager and HR unless "Share
/// with [name]" is on (then the joiner gets them, with a push). True once
/// saved.
Future<bool?> showOneOnOneNoteSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(context, builder: (_) => _NoteSheet(shell: shell, journeyId: journeyId, firstName: firstName));

class _NoteSheet extends StatefulWidget {
  const _NoteSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends State<_NoteSheet> {
  final _text = TextEditingController();
  bool _shared = false;
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.addNote(widget.journeyId, _text.text.trim(), shared: _shared);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Notes from your 1:1', style: _SheetText.title),
        const SizedBox(height: 4),
        const Text('Only you and HR see these unless you share them.', style: _SheetText.sub),
        const SizedBox(height: 16),
        Semantics(
          label: '1:1 notes',
          child: OnbTextArea(
            fieldKey: const ValueKey('note-text'),
            controller: _text,
            hint: 'How it went, what you agreed…',
            minLines: 5,
            onChanged: (_) => setState(() {}),
          ),
        ),
        const SizedBox(height: 16),
        // "Share with Kabir": a grey row with the switch, as drawn.
        Semantics(
          toggled: _shared,
          label: 'Share with ${widget.firstName}',
          child: ExcludeSemantics(
            child: Material(
              key: const ValueKey('note-share'),
              color: OnbColors.screen,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => setState(() => _shared = !_shared),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      Expanded(child: Text('Share with ${widget.firstName}', style: OnbText.bodyStrong)),
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 150),
                        width: 44,
                        height: 26,
                        decoration: BoxDecoration(color: _shared ? OnbColors.green : OnbColors.lineDark, borderRadius: BorderRadius.circular(999)),
                        child: AnimatedAlign(
                          duration: const Duration(milliseconds: 150),
                          alignment: _shared ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            width: 20,
                            height: 20,
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        OnbPrimaryButton(
          key: const ValueKey('note-save'),
          label: 'Save notes',
          busy: _busy,
          onTap: _text.text.trim().isEmpty ? null : _save,
        ),
      ],
    ),
  );
}

// ─── M2 · Post a welcome ────────────────────────────────────────────────────

/// "Post a welcome": the manager's own welcome for the joiner, posted to
/// Connect on the joiner's new-joiner card. Once per joiner. True once posted.
Future<bool?> showWelcomePostSheet(BuildContext context, OnboardingShell shell, String journeyId, String firstName) =>
    showOnbSheet<bool>(context, builder: (_) => _WelcomeSheet(shell: shell, journeyId: journeyId, firstName: firstName));

class _WelcomeSheet extends StatefulWidget {
  const _WelcomeSheet({required this.shell, required this.journeyId, required this.firstName});

  final OnboardingShell shell;
  final String journeyId;
  final String firstName;

  @override
  State<_WelcomeSheet> createState() => _WelcomeSheetState();
}

class _WelcomeSheetState extends State<_WelcomeSheet> {
  late final _text = TextEditingController(
    text: 'Please welcome ${widget.firstName} to the team! Say hi and help them feel at home.',
  );
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    setState(() => _busy = true);
    try {
      await widget.shell.api.postWelcome(widget.journeyId, _text.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showAppToast(context, onboardingErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Welcome ${widget.firstName}', style: OnbText.h1),
        const SizedBox(height: 4),
        Text('Shows on the Connect feed, on ${widget.firstName}’s new-joiner card. You can post it once.', style: OnbText.label),
        const SizedBox(height: 14),
        OnbTextArea(
          fieldKey: const ValueKey('welcome-text'),
          controller: _text,
          hint: 'Say hello to ${widget.firstName}…',
          minLines: 3,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        OnbPrimaryButton(
          key: const ValueKey('welcome-post'),
          label: 'Post to Connect',
          busy: _busy,
          onTap: _text.text.trim().isEmpty || _text.text.trim().length > 500 ? null : _post,
        ),
      ],
    ),
  );
}
