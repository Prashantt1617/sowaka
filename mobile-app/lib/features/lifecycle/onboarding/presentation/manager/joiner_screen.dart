import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../profile/profile_launcher.dart';
import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../onboarding_kit.dart';
import '../task_row.dart';
import 'joiner_setup_screen.dart';
import 'probation_review_screen.dart';
import 'starter_review_screen.dart';
import 'team_kit.dart';
import 'team_meeting_screen.dart';

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

  /// From View progress: their meetings, then their own tasks.
  theirMeetings,
  theirTasks,
}

/// A joiner as their manager sees them (Teams › Joiners, artifact
/// 8C82Qv57Z88eV7VTVQpFGZ, layout C): who they are at the top, "Your tasks
/// for Priya" as the main card with what is due now ready to tick, and two
/// smaller tiles — their onboarding (View progress) and Reach out (Choose
/// how). Each opens its own page here; a meeting opens its agenda and notes.
class JoinerScreen extends StatefulWidget {
  const JoinerScreen({super.key, required this.shell, required this.journeyId, this.openSetup = false, this.summary, this.page = JoinerPage.main});

  final OnboardingShell shell;
  final String journeyId;

  /// The Team tab's row for this joiner: the card paints from it at once.
  final JoinerSummary? summary;

  /// Opens the set-up straight away (from the "set up your joiner" push).
  final bool openSetup;

  /// Where it opens (the artifact's key screens open on their sub-page).
  final JoinerPage page;

  @override
  State<JoinerScreen> createState() => _JoinerScreenState();
}

class _JoinerScreenState extends State<JoinerScreen> {
  JoinerDetail? _detail;
  String? _error;
  bool _openedSetup = false;
  final Set<String> _busyTasks = {};
  late JoinerPage _page = widget.page;

  /// Where Back goes from a page opened from View progress.
  JoinerPage get _parent => switch (_page) {
    JoinerPage.theirMeetings || JoinerPage.theirTasks => JoinerPage.progress,
    _ => JoinerPage.main,
  };

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_first());
  }

  /// Last time's page from the device at once (or the Team tab's row), then live.
  Future<void> _first() async {
    final kept = await _shell.api.fromDevice((api) => api.fetchJoiner(widget.journeyId));
    if (kept != null && mounted && _detail == null) setState(() => _detail = kept);
    await _load();
  }

  Future<void> _load() async {
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

  Future<void> _markDone(TaskView task) async {
    setState(() => _busyTasks.add(task.id));
    try {
      await _shell.api.managerTaskDone(widget.journeyId, task.id);
      if (mounted && (task.isTimed || task.kind == 'meeting')) showAppToast(context, 'Marked as done');
      await _load();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busyTasks.remove(task.id));
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

  String _title(JoinerSummary? joiner) => switch (_page) {
    JoinerPage.main => 'Joiners',
    JoinerPage.tasks => 'All tasks',
    _ => joiner?.name ?? 'New joiner',
  };

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
                  const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
                ],
              )
            : OnbLoadState(error: _error, onRetry: _load),
      ),
    );
  }

  /// Who they are: photo, name, designation, reports to you, their buddy, the stage.
  Widget _hero(JoinerSummary joiner, JoinerDetail? detail, DateTime now) {
    final buddy = detail?.setup.buddy?.name;
    return KeyedSubtree(
      key: const ValueKey('mgr-hero'),
      child: TeamPersonHero(
        name: joiner.name,
        photoUrl: joiner.photoUrl,
        designation: joiner.designation,
        reportsLine: 'Reports to you',
        buddyLine: detail == null ? '' : (buddy == null || buddy.isEmpty ? 'No buddy yet' : 'Buddy: $buddy'),
        stage: teamStageLabel(joiner, now),
        plant: teamPlantOf(joiner),
        onOpenProfile: () => _openProfile(joiner),
      ),
    );
  }

  Widget _body(JoinerDetail detail) {
    final now = _shell.now();
    final children = switch (_page) {
      JoinerPage.main => _main(detail, now),
      JoinerPage.tasks => _allTasks(detail, now),
      JoinerPage.progress => _progress(detail, now),
      JoinerPage.reachOut => _reachOut(detail),
      JoinerPage.theirMeetings => _theirMeetings(detail, now),
      JoinerPage.theirTasks => _theirTasks(detail, now),
    };
    return ListView(
      key: ValueKey('joiner-page-${_page.name}'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: children,
    );
  }

  // ─── What is yours to do ──────────────────────────────────────────────────

  /// Your tasks now: open and not locked, the timed ones first.
  List<TaskView> _openNow(JoinerDetail detail) =>
      orderTaskList(detail.managerTasks.where((t) => t.isOpen || t.status == 'in_review').toList());

  /// What opens later, soonest first.
  List<TaskView> _comingUp(JoinerDetail detail) {
    final later = detail.managerTasks.where((t) => t.isLocked).toList();
    later.sort((a, b) => (a.opensAt ?? a.dueAt ?? DateTime(9999)).compareTo(b.opensAt ?? b.dueAt ?? DateTime(9999)));
    return later;
  }

  List<Widget> _main(JoinerDetail detail, DateTime now) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final open = _openNow(detail);
    final soon = _comingUp(detail);
    // What is due now, up to three; nothing due → the next ones that can be done early.
    final due = open.take(3).toList();
    final late = detail.joinerTasks.where((t) => t.late && !t.isDone).toList();
    final next = soon.isEmpty ? null : soon.first;
    return [
      _hero(joiner, detail, now),
      const SizedBox(height: 14),
      TeamTasksCard(
        title: 'Your tasks for $first',
        openCount: open.length,
        rows: _lastWithoutLine([for (final task in due) _taskRow(detail, task, now)]),
        emptyText: next == null ? 'Nothing due right now.' : 'Nothing due right now. Next: ${next.title}',
        onViewAll: () => _go(JoinerPage.tasks),
      ),
      const SizedBox(height: 14),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TeamSmallTile(
              key: const ValueKey('tile-onboarding'),
              label: '$first’s onboarding',
              dot: late.isEmpty ? TeamColors.okFg : TeamColors.warnFg,
              line: _statusShort(detail),
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

  /// "On track", "Joining soon", "1 task delayed".
  String _statusShort(JoinerDetail detail) {
    final late = detail.joinerTasks.where((t) => t.late && !t.isDone).length;
    if (late > 0) return '$late ${late == 1 ? 'task' : 'tasks'} delayed';
    if (detail.joiner.preboarding) return 'Joining soon';
    if (detail.joiner.stage == 'confirmed') return 'Confirmed';
    return 'On track';
  }

  /// One of your tasks, as a row: tick what you can tick here, open what has
  /// its own screen, a lock on what opens later.
  Widget _taskRow(JoinerDetail detail, TaskView task, DateTime now) {
    final kind = TeamTaskKind.of(task);
    final busy = _busyTasks.contains(task.id);
    final key = ValueKey('mgr-task-${task.id}');
    if (task.isLocked) {
      final opens = task.opensAt;
      return TeamTaskRow(
        divider: false,
        key: key,
        kind: kind,
        title: task.title,
        sub: opens == null ? 'Opens later' : 'Opens ${onbDay(opens)}',
        end: TeamRowEnd.locked,
      );
    }
    final opener = _opener(detail, task);
    final tickable = managerMayTick(task);
    final hr = !tickable && opener == null && (task.ownerRole == 'hr_manager' || task.ownerRole == 'hr');
    final start = task.startsAt;
    String? pill;
    var pillBg = OnbColors.screen, pillFg = OnbColors.text2;
    if (task.isDone) {
      pill = null;
    } else if (hr) {
      pill = 'With HR';
    } else if (task.late) {
      pill = 'Late';
      pillBg = TeamColors.countRedBg;
      pillFg = TeamColors.countRedFg;
    } else if (start != null) {
      final minutes = start.difference(now).inMinutes;
      if (minutes <= 10 && minutes >= -60) {
        pill = 'Now';
        pillBg = OnbColors.primary;
        pillFg = Colors.white;
      } else {
        pill = calendarDaysBetween(now, start) == 0 ? compactTime(start) : onbDay(start).split(' ').first;
      }
    } else if (task.status == 'in_review') {
      pill = 'Ready to review';
      pillBg = TeamColors.blueBg;
      pillFg = OnbColors.primary;
    }
    final end = opener != null
        ? TeamRowEnd.chevron
        : tickable || task.isDone
        ? TeamRowEnd.tick
        : TeamRowEnd.none;
    return TeamTaskRow(
      divider: false,
      key: key,
      kind: kind,
      title: task.title,
      sub: _mgrMeta(task, now),
      pill: pill,
      pillBg: pillBg,
      pillFg: pillFg,
      end: end,
      done: task.isDone,
      busy: busy,
      onOpen: opener,
      onTick: tickable && !task.isDone ? () => _markDone(task) : null,
    );
  }

  /// The screen a task opens, when it has one.
  VoidCallback? _opener(JoinerDetail detail, TaskView task) {
    switch (task.systemKey) {
      case 'starter_task':
        return () => _assign(detail);
      case 'one_on_one_notes':
      case 'manager_30day_note':
        return () => _note(detail);
      case 'manager_setup':
      case 'assign_buddy':
      case 'probation_goals':
      case 'people_to_meet':
        return () => _setup(detail);
      case 'monthly_goals':
      case 'monthly_checkin':
      case 'monthly_review':
        final month = task.month ?? 1;
        return () => _push(
          ProbationReviewScreen(
            shell: _shell,
            journeyId: widget.journeyId,
            month: month,
            initial: detail.probation?.months.where((m) => m.monthNo == month).firstOrNull,
            joinerName: detail.joiner.name,
          ),
        );
    }
    if (task.isTimed || task.kind == 'meeting') {
      return () => _push(TeamMeetingScreen.forManager(shell: _shell, journeyId: widget.journeyId, task: task, joiner: detail.joiner));
    }
    return null;
  }

  // ─── View all ─────────────────────────────────────────────────────────────

  List<Widget> _allTasks(JoinerDetail detail, DateTime now) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final open = _openNow(detail);
    final done = detail.managerTasks.where((t) => t.isDone).toList()
      ..sort((a, b) => (b.doneAt ?? DateTime(0)).compareTo(a.doneAt ?? DateTime(0)));
    final soon = _comingUp(detail);
    final rows = <Widget>[
      for (final task in open) _taskRow(detail, task, now),
      // "Post a welcome", once per joiner, while it can still be posted.
      if (detail.welcomeCanPost)
        TeamTaskRow(
          divider: false,
          key: const ValueKey('mgr-welcome'),
          kind: TeamTaskKind.chat,
          title: 'Post a welcome',
          sub: 'Shows on the Connect feed',
          end: TeamRowEnd.chevron,
          onOpen: () => _welcome(detail),
        ),
      // The starter tasks you gave: due, or done with their note to read.
      for (final task in detail.starterTasks)
        TeamTaskRow(
          divider: false,
          key: ValueKey('mgr-starter-${task.id}'),
          kind: TeamTaskKind.task,
          title: task.title,
          sub: task.done
              ? '$first marked it done${task.doneAt == null ? '' : ' · ${onbDay(task.doneAt!)}'}'
              : (task.dueAt == null ? 'Starter task' : 'Due by ${onbDay(task.dueAt!)}'),
          pill: task.done ? (task.managerReply == null ? 'Reply' : 'Replied') : 'Sent',
          pillBg: task.done && task.managerReply == null ? TeamColors.blueBg : OnbColors.screen,
          pillFg: task.done && task.managerReply == null ? OnbColors.primary : OnbColors.text2,
          end: task.done ? TeamRowEnd.chevron : TeamRowEnd.none,
          onOpen: task.done
              ? () => _push(
                  StarterReviewScreen(
                    shell: _shell,
                    journeyId: widget.journeyId,
                    starterTaskId: task.id,
                    initial: task,
                    joinerName: joiner.name,
                    joinerPhotoUrl: joiner.photoUrl,
                  ),
                )
              : null,
        ),
      for (final task in done) _taskRow(detail, task, now),
      if (detail.welcomePostedAt != null)
        TeamTaskRow(
          divider: false,
          key: const ValueKey('mgr-welcome-done'),
          kind: TeamTaskKind.chat,
          title: 'Post a welcome',
          sub: 'Posted ${onbDay(detail.welcomePostedAt!)}',
          end: TeamRowEnd.tick,
          done: true,
        ),
    ];
    final later = [for (final task in soon) _taskRow(detail, task, now)];
    final inProbation = joiner.stage != null && joiner.stage != 'pre_boarding' && joiner.stage != 'welcome_week1';
    return [
      TeamSectionTitle('Your tasks for $first', meta: open.isEmpty ? 'All done for now' : '${open.length} to do'),
      const SizedBox(height: 10),
      TeamListCard(
        radius: 16,
        children: [
          if (rows.isEmpty && later.isEmpty)
            const Padding(padding: EdgeInsets.all(14), child: Text('Nothing waiting on you.', style: OnbText.body)),
          ..._lastWithoutLine(rows),
          if (later.isNotEmpty) ...[const TeamListHead('Coming up'), ..._lastWithoutLine(later)],
        ],
      ),
      // What only exists later: notes from your 1:1s, the probation months, survey summaries.
      if (detail.notes.isNotEmpty) ...[
        const SizedBox(height: 18),
        TeamSectionTitle('Notes from your 1:1s', trailing: OnbLink(key: const ValueKey('add-note-more'), label: 'Add', onTap: () => _note(detail))),
        const SizedBox(height: 8),
        for (final note in detail.notes)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(note.createdAt == null ? '' : onbDayTime(note.createdAt!), style: _MgrText.meta)),
                      OnbTag(note.shared ? (note.seen ? 'Shared · seen' : 'Shared') : 'Private', tone: note.shared ? OnbTone.count : OnbTone.locked),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(note.text, style: OnbText.body),
                  for (final reply in note.replies)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text('${reply.mine ? 'You' : (reply.byName ?? first)}: ${reply.text}', style: _MgrText.meta),
                    ),
                ],
              ),
            ),
          ),
      ],
      if (inProbation && detail.probation != null && detail.probation!.months.isNotEmpty) ...[
        const SizedBox(height: 18),
        const TeamSectionTitle('Probation'),
        const SizedBox(height: 8),
        TeamListCard(
          radius: 16,
          children: _lastWithoutLine([
            for (final month in detail.probation!.months)
              TeamTaskRow(
                divider: false,
                key: ValueKey('mgr-month-${month.monthNo}'),
                kind: TeamTaskKind.goal,
                title: 'Month ${month.monthNo}',
                sub: [
                  '${month.goals.length} goals',
                  month.checkinEmployee == null ? 'no check-in yet' : '$first checked in',
                  if (month.review != null) 'reviewed',
                ].join(' · '),
                pill: month.review != null && month.bothCheckedIn ? 'Reviewed' : null,
                pillBg: TeamColors.okBg,
                pillFg: TeamColors.okFg,
                end: TeamRowEnd.chevron,
                onOpen: () => _push(
                  ProbationReviewScreen(shell: _shell, journeyId: widget.journeyId, month: month.monthNo, initial: month, joinerName: joiner.name),
                ),
              ),
          ]),
        ),
      ],
      // One summary per survey kind, only once 3+ different people answered it (the server's rule).
      for (final survey in detail.surveys)
        if (survey.count >= 3) ...[
          const SizedBox(height: 12),
          OnbCard(
            key: ValueKey('survey-${survey.kind}'),
            child: Text(
              'Your team’s ${surveyKindName(survey.kind)}: ${survey.count} people answered'
              '${survey.avg == null ? '' : ', ${survey.avg!.toStringAsFixed(1)} out of 5 on average'}. Names are never shown.',
              style: OnbText.body,
            ),
          ),
        ],
    ];
  }

  /// A card's rows with a hairline between them (none under the last).
  List<Widget> _lastWithoutLine(List<Widget> rows) => [
    for (final (i, row) in rows.indexed) ...[
      if (i > 0) const Divider(height: 1, thickness: 1, color: OnbColors.line),
      row,
    ],
  ];

  // ─── View progress ────────────────────────────────────────────────────────

  List<Widget> _progress(JoinerDetail detail, DateTime now) {
    final joiner = detail.joiner;
    final first = joiner.firstName;
    final late = detail.joinerTasks.where((t) => t.late && !t.isDone).toList();
    final status = _statusShort(detail);
    final warn = late.isNotEmpty;
    final stats = <Widget>[];
    // Meetings set up for them so far (the ones that have happened or are due).
    final meetings = detail.meetings.where((m) => m.startsAt == null || !m.startsAt!.isAfter(now.add(const Duration(days: 1)))).toList();
    if (meetings.isNotEmpty) {
      final met = meetings.where((m) => m.met == 'yes').length;
      stats.add(
        TeamStatRow(
          divider: false,
          key: const ValueKey('stat-meetings'),
          title: 'Meetings',
          value: '$met/${meetings.length}',
          meta: 'met',
          fraction: met / meetings.length,
          bar: TeamColors.okFg,
          flag: met >= meetings.length ? 'Done' : '${meetings.length - met} to go',
          flagBg: met >= meetings.length ? TeamColors.okBg : OnbColors.screen,
          flagFg: met >= meetings.length ? TeamColors.okFg : OnbColors.text2,
          onTap: () => _go(JoinerPage.theirMeetings),
        ),
      );
    }
    final now0 = detail.joinerTasks.where((t) => !t.isLocked && t.status != 'cancelled').toList();
    if (now0.isNotEmpty) {
      final done = now0.where((t) => t.isDone).length;
      final left = now0.length - done;
      stats.add(
        TeamStatRow(
          divider: false,
          key: const ValueKey('stat-tasks'),
          title: 'Tasks',
          value: '$done/${now0.length}',
          meta: 'done',
          fraction: done / now0.length,
          bar: const Color(0xFF6B4FBB),
          flag: warn ? '${late.length} delayed' : (left == 0 ? 'Done' : '$left not done'),
          flagBg: warn ? TeamColors.warnBg : (left == 0 ? TeamColors.okBg : OnbColors.screen),
          flagFg: warn ? TeamColors.warnFg : (left == 0 ? TeamColors.okFg : OnbColors.text2),
          onTap: () => _go(JoinerPage.theirTasks),
        ),
      );
    }
    final own = detail.joiner;
    return [
      Row(
        children: [
          Expanded(child: Text('$first’s onboarding', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: TeamColors.ink))),
          TeamPill(
            status,
            key: const ValueKey('progress-status'),
            background: warn ? TeamColors.warnBg : TeamColors.okBg,
            foreground: warn ? TeamColors.warnFg : TeamColors.okFg,
            height: 26,
          ),
        ],
      ),
      if (warn) ...[
        const SizedBox(height: 14),
        TeamDelayBanner(late.length == 1 ? '${late.first.title}, late' : '${late.length} tasks late: ${late.map((t) => t.title).take(2).join(', ')}'),
      ],
      const SizedBox(height: 14),
      if (stats.isNotEmpty) TeamListCard(radius: 16, children: _lastWithoutLine(stats)),
      if (own.preboarding && own.tj != null) ...[
        const SizedBox(height: 14),
        Container(
          key: const ValueKey('joining-details'),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('JOINING DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
              const SizedBox(height: 4),
              Text('Joins ${onbDay(own.tj!)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
            ],
          ),
        ),
      ],
      if (detail.joinerNextDue case final next? when next.dueAt != null && !warn) ...[
        const SizedBox(height: 12),
        Text(
          'On track. ${next.title} ${next.title.endsWith('s') ? 'are' : 'is'} due ${onbDay(next.dueAt!)}.',
          key: const ValueKey('joiner-on-track'),
          style: _MgrText.meta,
        ),
      ],
      const SizedBox(height: 14),
      TeamFootnote('You can see where $first is. Survey answers and meeting notes stay private.'),
    ];
  }

  (String, Color, Color) _tone(String tone) => switch (tone) {
    'ok' => ('Done', TeamColors.okBg, TeamColors.okFg),
    'warn' => ('Late', TeamColors.warnBg, TeamColors.warnFg),
    _ => ('To do', OnbColors.screen, OnbColors.text2),
  };

  List<Widget> _theirMeetings(JoinerDetail detail, DateTime now) {
    final first = detail.joiner.firstName;
    final met = detail.meetings.where((m) => m.met == 'yes').length;
    final rows = <Widget>[];
    final later = <Widget>[];
    for (final m in detail.meetings) {
      final upcoming = m.met != 'yes' && m.startsAt != null && m.startsAt!.isAfter(now.add(const Duration(days: 1)));
      final who = m.attendees.map((p) => p.name).where((n) => n.isNotEmpty).join(', ');
      final (label, bg, fg) = m.met == 'yes'
          ? ('Met', TeamColors.okBg, TeamColors.okFg)
          : upcoming
          ? (onbDay(m.startsAt!), OnbColors.screen, OnbColors.text3)
          : ('Not yet', OnbColors.screen, OnbColors.text2);
      (upcoming ? later : rows).add(TeamStatusRow(divider: false, title: m.withWho ?? m.title, meta: who.isEmpty ? m.title : who, status: label, bg: bg, fg: fg));
    }
    return [
      TeamSectionTitle('Meetings', meta: '$met of ${detail.meetings.length} met'),
      const SizedBox(height: 10),
      TeamListCard(radius: 16, children: [..._lastWithoutLine(rows), if (later.isNotEmpty) ...[const TeamListHead('Coming up'), ..._lastWithoutLine(later)]]),
      const SizedBox(height: 14),
      TeamFootnote('Meeting notes stay private to $first.'),
    ];
  }

  List<Widget> _theirTasks(JoinerDetail detail, DateTime now) {
    final tasks = detail.joinerTasks.where((t) => t.status != 'cancelled').toList();
    final nowRows = <Widget>[];
    final later = <Widget>[];
    for (final t in tasks) {
      if (t.isLocked) {
        later.add(TeamStatusRow(divider: false, title: t.title, meta: t.opensAt == null ? null : 'Opens ${onbDay(t.opensAt!)}', status: 'Later', bg: OnbColors.screen, fg: OnbColors.text3));
        continue;
      }
      final (label, bg, fg) = _tone(t.isDone ? 'ok' : (t.late ? 'warn' : 'todo'));
      nowRows.add(TeamStatusRow(divider: false, title: t.title, meta: t.isDone ? null : taskMeta(t, now, forManager: true), status: label, bg: bg, fg: fg));
    }
    final left = tasks.where((t) => !t.isLocked && !t.isDone).length;
    return [
      TeamSectionTitle('Tasks', meta: left == 0 ? 'All done' : '$left to do'),
      const SizedBox(height: 10),
      TeamListCard(radius: 16, children: [..._lastWithoutLine(nowRows), if (later.isNotEmpty) ...[const TeamListHead('Coming up'), ..._lastWithoutLine(later)]]),
      const SizedBox(height: 14),
      const TeamFootnote('Survey answers go to HR only.'),
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
      const SizedBox(height: 10),
      TeamReachOutBlocks(ways: ways),
    ];
  }
}

/// "4 PM", "11:30 AM": the pill's time, as the design writes it.
String compactTime(DateTime at) {
  final full = onbTime(at);
  return full.replaceFirst(':00 ', ' ');
}

/// The row's second line: "Mon · 11:00 AM · must-do", "Due by Fri 5 Dec",
/// "After you meet"; late and done as the task list words them.
String _mgrMeta(TaskView task, DateTime now) {
  final must = task.mustDo ? ' · must-do' : '';
  final start = task.startsAt;
  if (start != null && !task.isDone) return '${onbDay(start).split(' ').first} · ${onbTime(start)}$must';
  if (task.late || task.isDone) return '${taskMeta(task, now, forManager: true)}$must';
  if (task.systemKey == 'starter_task' && task.dueAt != null) return 'Due by ${onbDay(task.dueAt!)}$must';
  if (task.systemKey == 'one_on_one_notes') return 'After you meet$must';
  return '${taskMeta(task, now, forManager: true)}$must';
}

abstract final class _MgrText {
  static const meta = TextStyle(fontSize: 12, height: 1.35, color: OnbColors.text3);
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
