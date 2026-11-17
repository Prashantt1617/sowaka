// The app's lifecycle parsers on what the server really sends.
//
// test/fixtures/lifecycle/*.json are written by the backend's
// `npm run lifecycle:fixtures` (backend/src/scripts/lifecycle-app-fixtures.ts):
// the real service functions behind every app endpoint, on a scratch company,
// answered as the routes send them. Here each one goes through the app's own
// HTTP client (HttpOnboardingApi, OffboardingApi, AuthApiService) over a mock
// transport, and the fields the screens depend on are checked.
// Regenerate the files after a server change, then run this.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_api_service.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding.dart' as off;
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart' as onb;
import 'package:mobile_app/features/lifecycle/onboarding/onboarding_launcher.dart' show onboardingDestinations, onboardingTileSubtitle;
import 'package:shared_preferences/shared_preferences.dart';

const _base = 'http://fixtures.test';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/lifecycle/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Answers `METHOD /path-prefix` with a fixture (first match wins) and
/// records what was asked.
class FixtureServer {
  FixtureServer(this.routes);

  final List<(String, String, String)> routes;
  final calls = <String>[];

  late final http.Client client = MockClient((request) async {
    final key = '${request.method} ${request.url.path}';
    calls.add(key);
    for (final (method, prefix, name) in routes) {
      if (request.method == method && request.url.path.startsWith(prefix)) {
        final body = fixture(name);
        // The auth fixtures carry the status the refusal went out with.
        final status = body['status'] is int && body['body'] is Map ? body['status'] as int : 200;
        final sent = body['body'] is Map && body.containsKey('status') ? body['body'] : body;
        return http.Response.bytes(utf8.encode(jsonEncode(sent)), status, headers: {'content-type': 'application/json; charset=utf-8'});
      }
    }
    return http.Response(jsonEncode({'error': 'No fixture for $key'}), 404);
  });
}

AuthSession session(String id, String name, {String role = 'employee'}) => AuthSession(
  token: '$id-token',
  user: AuthUser(id: id, email: '$id@fixture.test', name: name, role: role, company: 'Fixture Works', org: 'el-fixtures'),
);

HttpOnboardingApi onboardingApi(FixtureServer server, {String id = 'isha', String name = 'Isha Verma'}) =>
    HttpOnboardingApi(session: session(id, name), baseUrl: _base, client: server.client);

off.OffboardingApi offboardingApi(FixtureServer server, {String id = 'ravi', String name = 'Ravi Menon'}) =>
    off.OffboardingApi(session: session(id, name), baseUrl: _base, client: server.client);

/// A calendar day ('YYYY-MM-DD') or an instant's local day, as the app reads it.
DateTime? day(Object? raw) => off.parseDay(raw);

void main() {
  // The offboarding store remembers an ended account's details on the device.
  setUp(() => SharedPreferences.setMockInitialValues({}));

  // ─────────────────────────────────────────────────────────────── /lifecycle/me
  group('/lifecycle/me (both readers)', () {
    test('a joiner in week 1: the tile, its day, stage, plant and steps', () async {
      final raw = fixture('me_joiner');
      final me = await onboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_joiner')])).fetchMe();
      expect(me.enabled, isTrue);
      expect(me.showsOnboarding, isTrue);
      final o = me.onboarding!;
      expect(o.journeyId, raw['onboarding']['journeyId']);
      expect(o.stage, 'welcome_week1');
      expect(o.dayLabel, 'Week 1');
      expect(o.plant.stage, raw['onboarding']['plant']['stage']);
      expect(o.plant.droop, raw['onboarding']['plant']['droop']);
      expect(o.progress, isNotNull, reason: 'the server counts the steps, so the tile needs no second call');
      expect(onboardingTileSubtitle(me), '${raw['onboarding']['progress']['done']} of ${raw['onboarding']['progress']['total']} steps done');
      final after = await onboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_joiner_after_week1')])).fetchMe();
      expect(after.onboarding!.progress!.done, greaterThan(o.progress!.done), reason: 'the week-1 reels and the intro count');
      // The offboarding reader: on, and nothing to leave.
      final offMe = await offboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_joiner')]), id: 'isha').fetchMe();
      expect(offMe.enabled, isTrue);
      expect(offMe.offboarding, isNull);
    });

    test('resigned, with the manager: no page yet', () async {
      final me = await offboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_with_manager')])).fetchMe();
      expect(me.offboarding!.status, 'with_manager');
      expect(me.offboarding!.resignationId, isNotNull);
      expect(me.offboarding!.pageVisible, isFalse);
      expect(me.offboarding!.tl, day(fixture('resignation_post')['resignation']['lastDayByNotice']));
    });

    test('on notice: the page, the journey, the last day, read the same by both', () async {
      final raw = fixture('me_on_notice')['offboarding'] as Map<String, dynamic>;
      final server = FixtureServer([('GET', '/lifecycle/me', 'me_on_notice')]);
      final me = await offboardingApi(server).fetchMe();
      final o = me.offboarding!;
      expect([o.status, o.journeyId, o.resignationId, o.pageVisible], ['accepted', raw['journeyId'], raw['resignationId'], true]);
      expect(o.tl, DateTime.parse(raw['tl'] as String));
      final onbMe = await onboardingApi(server, id: 'ravi', name: 'Ravi Menon').fetchMe();
      expect(onbMe.enabled, me.enabled);
      expect(onbMe.showsOnboarding, isFalse);
      expect(onbMe.offboarding['journeyId'], o.journeyId, reason: 'the onboarding reader keeps the offboarding part as sent');
      expect(day(onbMe.offboarding['tl']), o.tl);
    });

    test('nobody leaving or joining: on, nothing else', () async {
      final me = await offboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_before_resigning')])).fetchMe();
      expect(me.enabled, isTrue);
      expect(me.offboarding, isNull);
    });
  });

  // ─────────────────────────────────────────────────────────────── the joiner
  group('onboarding: the joiner', () {
    test('home: Up next with its meeting, the lists, the journey bar, the manager', () async {
      final raw = fixture('home_with_meeting');
      final home = await onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding', 'home_with_meeting')])).fetchHome();
      expect(home.journeyId, raw['journeyId']);
      expect(home.dayLabel, 'Week 1');
      expect(home.tj, DateTime.parse(raw['tj'] as String));
      expect(home.managerName, 'Meera Iyer');
      final up = home.upNext!;
      expect(up.systemKey, 'meet_manager');
      expect(up.meetingId, 'fx-meeting');
      expect(up.meeting, isNotNull);
      expect(up.meeting!.startsAt, DateTime.parse(raw['upNext']['meeting']['startsAt'] as String).toLocal());
      expect(up.isTimed, isTrue, reason: 'the meeting gives Up next its time');
      expect(up.meeting!.attendees.map((a) => a.name), ['Isha Verma', 'Meera Iyer']);
      expect(up.meeting!.attendees.map((a) => a.role), ['joiner', 'manager']);
      expect(up.meeting!.expect, isNotEmpty);
      expect(up.meeting!.place, 'Room 4B');
      expect(home.today.length, (raw['today'] as List).length);
      expect(home.today.every((t) => t.forEmployee || t.readOnly), isTrue, reason: 'the joiner’s own rows, and others’ only read-only');
      // Day 1's items others do: listed, read-only, with who does them.
      final others = {for (final t in home.all.where((t) => t.readOnly)) t.systemKey: t.doneBy};
      expect(others, {'welcome_induction': 'HR', 'vision_culture': 'HR', 'meet_team': 'Your manager', 'laptop_setup': 'IT'});
      // Every meeting row carries its meeting; a date-only due day is never a clock time.
      final mm = home.today.firstWhere((t) => t.systemKey == 'meet_manager');
      expect(mm.meeting?.id, 'fx-meeting');
      for (final t in home.all.where((t) => t.meeting == null)) {
        expect(t.startsAt, isNull, reason: '${t.title}: no meeting, no time (never 5:30 AM)');
        if (t.dueAt != null) expect([t.dueAt!.hour, t.dueAt!.minute], [0, 0]);
      }
      // App copy, not the template's developer helper.
      expect(home.all.map((t) => t.helper ?? ''), everyElement(isNot(matches(RegExp('push|Timed item|say hi|HR sees')))));
      expect(home.progress.total, raw['progress']['total'], reason: 'the server’s count: one source with the tile');
      expect(home.later.every((t) => t.isLocked), isTrue);
      expect(home.done.every((t) => t.isDone), isTrue);
      expect(home.journey.map((s) => s.key), ['pre_boarding', 'welcome_week1', 'settling_in', 'growing_gains', 'final_month', 'ready_to_perform']);
      expect(home.journey.singleWhere((s) => s.isCurrent).key, 'welcome_week1');
      final reels = home.all.firstWhere((t) => t.systemKey == 'week1_reels');
      expect(reels.progress, isNotNull, reason: 'the "2 of 4" badge');
      expect(reels.progress!.total, 4);
      final starter = home.all.where((t) => t.systemKey == 'starter_task');
      expect(starter, isNotEmpty);
      final plain = fixture('onboarding_home');
      expect(onb.OnboardingHome.fromJson(plain).upNext, isNotNull);
    });

    test('ticking a task', () async {
      final task = await onboardingApi(FixtureServer([('POST', '/lifecycle/onboarding/tasks/', 'onboarding_task_action')])).taskAction('t', 'done');
      expect(task!.systemKey, 'app_tour');
      expect(task.isDone, isTrue);
    });

    test('week-1 reels: the policy list apart from the acknowledgement, each step, the goals', () async {
      final api = onboardingApi(FixtureServer([
        ('GET', '/lifecycle/onboarding/week1', 'week1_get'),
        ('PUT', '/lifecycle/onboarding/week1', 'week1_put_policies'),
      ]));
      final before = await api.fetchWeek1();
      expect(before.policies.map((p) => p.id), ['leave', 'conduct']);
      expect(before.policies.first.title, 'Leave policy');
      expect(before.policies.first.version, isNotEmpty);
      expect(before.doneCount, 0);
      expect(before.resumeAt, onb.Week1Step.policies);
      expect(before.managerName, 'Meera Iyer');
      expect(before.probationMonths, 6);
      expect(before.goalsLockOn, isNotNull);
      expect(before.goals, ['Ship the leave redesign', 'Meet every designer']);
      final policies = (await api.saveWeek1(onb.Week1Step.policies, {'agreed': true}))!;
      expect(policies.policiesAckAt, isNotNull);
      expect(policies.policies, hasLength(2), reason: 'the list survives the acknowledgement');
      expect(policies.resumeAt, onb.Week1Step.tax);
      final tax = onb.Week1Data.fromJson(fixture('week1_put_tax'));
      expect(tax.taxRegime, 'new');
      expect(tax.resumeAt, onb.Week1Step.bankPf);
      final done = onb.Week1Data.fromJson(fixture('week1_done'));
      expect(done.doneCount, 4);
      expect(done.resumeAt, isNull);
      expect(done.bankMasked, isNull, reason: 'no bank details on file: nothing masked to show');
    });

    test('intro post: draft, saved, posted', () async {
      final api = onboardingApi(FixtureServer([
        ('GET', '/lifecycle/onboarding/intro', 'intro_get'),
        ('PUT', '/lifecycle/onboarding/intro', 'intro_put'),
        ('POST', '/lifecycle/onboarding/intro/post', 'intro_post'),
      ]));
      expect((await api.fetchIntro()).posted, isFalse);
      final saved = await api.saveIntro(const onb.IntroPost(line: 'x'));
      expect(saved.line, 'Designer who sketches on trains');
      expect(saved.funFacts, ['Chai over coffee', 'Weekend trekker']);
      final posted = await api.postIntro();
      expect(posted.posted, isTrue);
      expect(posted.connectPostId, isNotNull);
    });

    test('people to meet', () async {
      final api = onboardingApi(FixtureServer([
        ('GET', '/lifecycle/onboarding/people', 'people_get'),
        ('POST', '/lifecycle/onboarding/people/', 'people_post'),
      ]));
      final people = await api.fetchPeople();
      expect(people.map((p) => p.name), ['Kiran Shah', 'Tara Bose']);
      expect(people.first.why, 'Your buddy for the first month');
      expect(people.first.designation, 'Designer');
      expect(people.every((p) => p.id.isNotEmpty && p.userId.isNotEmpty), isTrue);
      expect(people.any((p) => p.met), isFalse);
      final after = (await api.markPerson(people.first.id, 'met'))!;
      expect(after.first.met, isTrue);
      expect(after.last.met, isFalse);
    });

    test('starter tasks: from whom, due, done, the reply', () async {
      final api = onboardingApi(FixtureServer([
        ('GET', '/lifecycle/onboarding/starter-tasks', 'starter_tasks_get'),
        ('POST', '/lifecycle/onboarding/starter-tasks/', 'starter_task_done'),
      ]));
      final tasks = await api.fetchStarterTasks();
      final task = tasks.single;
      expect(task.title, 'Redesign the leave request screen');
      expect(task.assignedByName, 'Meera Iyer');
      expect(task.dueAt, isNotNull);
      expect(task.links, ['https://docs.example/leave']);
      expect(task.done, isFalse);
      final done = await api.markStarterTaskDone(task.id, note: 'x');
      expect(done, isNotNull, reason: 'the server sends the task as it now stands');
      expect(done!.done, isTrue);
      expect(done.doneNote, 'First version is in the folder');
    });

    test('shared 1:1 notes: only the shared one, who wrote it, the replies', () async {
      final api = onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/notes', 'notes_get')]));
      final notes = await api.fetchNotes();
      expect(notes.map((n) => n.text), ['Settling in well. Next: the design crit.']);
      expect(notes.single.authorName, 'Meera Iyer');
      expect(notes.single.shared, isTrue);
      final replied = fixture('note_action')['notes'] as List;
      final note = onb.OneOnOneNote.fromJson((replied.single as Map).cast<String, dynamic>(), viewerId: 'isha');
      expect(note.replies.single.text, 'Thanks, Meera!');
      expect(note.replies.single.mine, isTrue);
      expect(note.seen, isTrue);
    });

    test('a meeting, and moving it', () async {
      final api = onboardingApi(FixtureServer([
        ('GET', '/lifecycle/onboarding/meetings/', 'meeting_get'),
        ('POST', '/lifecycle/onboarding/meetings/', 'meeting_post_moved'),
      ]));
      final m = await api.fetchMeeting('fx-meeting');
      expect([m.id, m.title, m.systemKey, m.mustDo], ['fx-meeting', 'Meet your manager', 'meet_manager', true]);
      expect(m.startsAt, isNotNull);
      expect(m.endsAt, isNotNull);
      expect(m.attendees, hasLength(2));
      expect(m.expect, hasLength(3));
      final moved = (await api.answerMeeting('fx-meeting', 'moved', newTime: DateTime.now()))!;
      expect(moved.met, 'moved');
      expect(moved.newTime, isNotNull);
      expect(moved.startsAt, moved.newTime, reason: 'moved is asked again at the new time');
    });

    test('the Day-7 survey', () async {
      final api = onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/survey', 'survey_get')]));
      final s = await api.fetchSurvey();
      expect([s.kind, s.open, s.sent], ['day7', true, false]);
      expect(s.title, 'Your first week');
      final sent = onb.SurveyState.fromJson(fixture('survey_post'));
      expect([sent.open, sent.sent], [false, true]);
    });

    test('probation: the months, which is now, how many, whose goals', () async {
      final api = onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/probation', 'probation_get')]));
      final p = await api.fetchProbation();
      expect(p.months.map((m) => m.monthNo), [1, 2, 3, 4, 5, 6]);
      expect(p.totalMonths, 6);
      expect(p.current!.monthNo, 1);
      expect(p.managerName, 'Meera Iyer');
      expect(p.months.every((m) => m.checkinManager == null), isTrue, reason: 'the manager’s check-in never reaches the joiner');
      final last = onb.ProbationView.fromJson(fixture('probation_final_month'));
      expect(last.current!.monthNo, 6);
    });

    test('the reveal: not yet, then the outcome, then seen', () async {
      final api = onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/reveal', 'reveal_not_ready')]));
      final none = await api.fetchReveal();
      expect(none.outcome, isNull);
      final ready = onb.RevealView.fromJson(fixture('reveal_ready'));
      expect([ready.outcome, ready.designation, ready.reportsTo, ready.seen], ['confirm', 'Senior Product Designer', 'Meera Iyer', false]);
      expect(ready.letterUrl, matches(RegExp(r'^/lifecycle/onboarding/letters/[0-9a-f-]+/pdf$')), reason: 'the letter HR sent opens from the reveal');
      expect(onb.RevealView.fromJson(fixture('reveal_seen')).seen, isTrue);
    });
  });

  // ─────────────────────────────────────────────────────────────── the manager's joiners
  group('onboarding: the audit’s gaps, on real output', () {
    test('“Week 1, done!” comes from the server, with its stats; seen is stored there', () async {
      final raw = fixture('home_week_done');
      final home = await onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding', 'home_week_done')]), id: 'rohan').fetchHome();
      expect(home.showWeekDone, isTrue);
      expect(home.weekDoneStats?.tasksDone, raw['weekDoneStats']['tasksDone']);
      final server = FixtureServer([('POST', '/lifecycle/onboarding/week-done/seen', 'week_done_seen')]);
      await onboardingApi(server, id: 'rohan').markWeekDoneSeen();
      expect(server.calls, ['POST /lifecycle/onboarding/week-done/seen']);
    });

    test('people to meet: the meet-by day, open, the buddy named as such', () async {
      final v = await onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/people', 'people_get')])).fetchPeopleView();
      expect(v.meetBy, isNotNull);
      expect(v.closed, isFalse);
      expect(v.people.firstWhere((p) => p.userId == 'p1').role, 'your buddy');
    });

    test('after week 1 the tile’s subtitle follows the stage', () async {
      final me = await onboardingApi(FixtureServer([('GET', '/lifecycle/me', 'me_settling_in')]), id: 'rohan').fetchMe();
      expect(onboardingTileSubtitle(me), fixture('me_settling_in')['onboarding']['subtitle']);
      expect(onboardingTileSubtitle(me), startsWith('Week 2 · '));
    });

    test('M2: meeting rows carry their meeting, manager wording, HR’s decision never tickable', () async {
      final d = await onboardingApi(FixtureServer([('GET', '/lifecycle/manager/joiners/', 'manager_joiner')]), id: 'mgr', name: 'Meera Iyer').fetchJoiner('j');
      final meet = d.tasks.firstWhere((t) => t.systemKey == 'meet_manager');
      expect(meet.title, 'Meet Isha');
      expect(meet.meeting?.id, 'fx-meeting');
      expect(meet.startsAt, isNotNull);
      expect(d.tasks.firstWhere((t) => t.systemKey == 'meet_team').title, 'Introduce Isha to the team');
      final decision = d.tasks.firstWhere((t) => t.systemKey == 'confirmation_discussion');
      expect([decision.canMarkDone, onb.managerMayTick(decision)], [false, false]);
      expect(d.journey.map((s) => s.label), contains('Months 2–5'));
      expect(d.welcomeCanPost, isTrue);
      final after = await onboardingApi(FixtureServer([('GET', '/lifecycle/manager/joiners/', 'manager_joiner_after_welcome')]), id: 'mgr').fetchJoiner('j');
      expect([after.welcomeCanPost, after.welcomePostedAt != null], [false, true]);
      final server = FixtureServer([('POST', '/lifecycle/manager/joiners/', 'manager_welcome_post')]);
      await onboardingApi(server, id: 'mgr').postWelcome('j', 'Welcome!');
      expect(server.calls.single, endsWith('/welcome'));
    });

    test('PB1/PB2 on the new shape: per-goal ratings, the win and ask, chips, next goals', () async {
      final months = onb.ProbationView.fromJson(fixture('manager_probation_review')).months;
      final m1 = months.firstWhere((m) => m.monthNo == 1);
      expect(m1.checkinEmployee!.goalRatings, [4, 5]);
      expect([m1.checkinEmployee!.win, m1.checkinEmployee!.ask], ['Shipped the onboarding flow', 'Access to analytics']);
      expect(m1.checkinManager!.goalRatings, [4, 4]);
      expect([m1.reviewFeedback, m1.askAck], [['Great start', 'Keep going'], true]);
      expect(months.firstWhere((m) => m.monthNo == 2).goals, ['Pair with two teams']);
      final mine = onb.ProbationView.fromJson(fixture('probation_checkin_put')).months.firstWhere((m) => m.monthNo == 1);
      expect(mine.checkinManager, isNull, reason: 'the joiner never sees the manager’s side');
    });

    test('the reveal: their own CTC (to them), and the manager never sees it', () async {
      final r = await onboardingApi(FixtureServer([('GET', '/lifecycle/onboarding/reveal', 'reveal_ready')]), id: 'ishita').fetchReveal();
      expect(r.salary, 1600000);
      expect(jsonEncode(fixture('manager_joiner_probation')).contains('1600000'), isFalse);
    });
  });

  group('onboarding: the manager', () {
    test('New joiners: the card', () async {
      final joiners = await onboardingApi(FixtureServer([('GET', '/lifecycle/manager/joiners', 'manager_joiners')]), id: 'mgr', name: 'Meera Iyer').fetchJoiners();
      final isha = joiners.firstWhere((j) => j.name == 'Isha Verma');
      expect(isha.journeyId, fixture('me_joiner')['onboarding']['journeyId']);
      expect(isha.userId, 'isha');
      expect(isha.dayLabel, 'Week 1');
      expect(isha.stage, 'welcome_week1');
      expect(isha.preboarding, isFalse);
      expect(isha.tj, isNotNull);
    });

    test('the joiner: tasks, set-up, starter tasks, notes, meetings, probation, goal lock', () async {
      final raw = fixture('manager_joiner');
      final d = await onboardingApi(FixtureServer([('GET', '/lifecycle/manager/joiners/', 'manager_joiner')]), id: 'mgr', name: 'Meera Iyer').fetchJoiner('j');
      expect(d.joiner.name, 'Isha Verma');
      expect(d.joiner.probationMonths, 6);
      expect(d.joiner.goalsLocked, raw['goalsLocked'], reason: 'the server’s lock, not the app’s own day count');
      expect(d.goalsLockedOn(DateTime(2100)), raw['goalsLocked']);
      expect(d.managerTasks, isNotEmpty);
      expect(d.setup.people.map((p) => p.userId), ['p1', 'p2']);
      expect(d.setup.people.first.name, 'Kiran Shah');
      expect(d.setup.buddy!.userId, 'p1');
      expect(d.setup.buddy!.name, 'Kiran Shah');
      expect(d.setup.welcomeNote, 'Welcome aboard, Isha!');
      expect(d.setup.goals, ['Ship the leave redesign', 'Meet every designer']);
      expect(d.starterTasks.single.assignedByName, 'Meera Iyer');
      expect(d.starterTasks.single.managerReply, 'Nice start!');
      expect(d.notes.map((n) => n.shared), containsAll([true, false]), reason: 'the manager sees their private notes too');
      expect(d.meetings.single.met, 'moved');
      expect(d.probation!.months, hasLength(6));
      expect(d.surveyCount, isNull, reason: 'one answer: no team summary');
      expect(jsonEncode(raw).contains('1600000'), isFalse, reason: 'managers never see pay');
    });
  });

  // ─────────────────────────────────────────────────────────────── resigning
  group('offboarding: resigning', () {
    test('before: the notice and Resign', () async {
      final s = await offboardingApi(FixtureServer([('GET', '/lifecycle/resignation', 'resignation_get_none')])).fetchResignation();
      expect(s.canResign, isTrue);
      expect(s.resignation, isNull);
      expect(s.noticeDays, 30);
      expect(s.lastDayByNotice, isNotNull);
    });

    test('sent, with the manager, then with HR', () async {
      final api = offboardingApi(FixtureServer([('POST', '/lifecycle/resignation', 'resignation_post')]));
      final r = await api.resign(reason: 'Better opportunity');
      expect([r.status, r.reason, r.note, r.managerName, r.noticeDays], ['with_manager', 'Better opportunity', 'Thank you for three great years.', 'Meera Iyer', 30]);
      expect(r.managerFirstName, 'Meera');
      expect(r.canWithdraw, isTrue);
      expect(r.lastDay, r.lastDayByNotice);
      expect(r.daysLeft, 30);
      final tab = off.ResignationState.fromJson(fixture('resignation_get_with_manager'));
      expect(tab.canResign, isFalse);
      expect(tab.resignation!.id, r.id);
      final withHr = off.ResignationState.fromJson(fixture('resignation_get_with_hr')).resignation!;
      expect(withHr.withHr, isTrue);
      expect(withHr.manager!.action, 'release_early');
      expect(withHr.manager!.byName, 'Meera Iyer');
      expect(withHr.lastDay, withHr.manager!.date, reason: 'the manager’s early release is the last day until HR says');
    });

    test('accepted: HR’s last day, no withdrawing', () async {
      final a = off.ResignationState.fromJson(fixture('resignation_get_accepted')).resignation!;
      expect(a.accepted, isTrue);
      expect(a.canWithdraw, isFalse);
      expect(a.hrAcceptedAt, isNotNull);
      expect(a.lastDay, day(fixture('me_on_notice')['offboarding']['tl']));
    });

    test('withdrawn', () async {
      await offboardingApi(FixtureServer([('POST', '/lifecycle/resignation/withdraw', 'resignation_withdraw')])).withdraw();
      final w = off.ResignationView.fromJson((fixture('resignation_withdraw')['resignation'] as Map).cast<String, dynamic>());
      expect(w.withdrawn, isTrue);
      expect(w.withdrawnAt, isNotNull);
      expect(w.daysLeft, isNull);
    });
  });

  // ─────────────────────────────────────────────────────────────── the manager's resignations
  group('offboarding: the manager', () {
    test('Requests: the card, who resigned; the answer', () async {
      final api = offboardingApi(FixtureServer([
        ('GET', '/lifecycle/manager/resignations', 'manager_resignations_with_manager'),
        ('POST', '/lifecycle/manager/resignations/', 'manager_resignation_action'),
      ]), id: 'mgr', name: 'Meera Iyer');
      final list = await api.fetchManagerResignations();
      final ravi = list.firstWhere((r) => r.userId == 'ravi');
      expect([ravi.name, ravi.designation, ravi.department, ravi.status, ravi.reason], ['Ravi Menon', 'Senior Designer', 'Design', 'with_manager', 'Better opportunity']);
      expect(ravi.note, 'Thank you for three great years.');
      final acted = (await api.actOnResignation(ravi.id, action: 'release_early', date: '2026-01-01'))!;
      expect(acted.withHr, isTrue);
      expect(acted.manager!.action, 'release_early');
    });

    test('after HR accepts the report keeps the Resignation tab (not a Requests card)', () async {
      off.OffboardingStore.reset();
      final server = FixtureServer([
        ('GET', '/lifecycle/me', 'me_before_resigning'),
        ('GET', '/lifecycle/resignation', 'resignation_get_none'),
        ('GET', '/lifecycle/manager/resignations', 'manager_resignations_accepted'),
      ]);
      off.OffboardingApi.testOverride = (s) => off.OffboardingApi(session: s, baseUrl: _base, client: server.client);
      addTearDown(() {
        off.OffboardingApi.testOverride = null;
        off.OffboardingStore.reset();
      });
      final store = off.OffboardingStore.of(session('mgr', 'Meera Iyer', role: 'manager'));
      await store.ensureLoaded();
      final ravi = store.resignationOf('ravi');
      expect(ravi, isNotNull, reason: 'the profile’s Resignation tab is where the handover checklist is written');
      expect(ravi!.accepted, isTrue);
      expect(ravi.tl, day(fixture('me_on_notice')['offboarding']['tl']));
      expect(store.pendingForManager, 0);
      expect(store.managerResignations.where((r) => !r.accepted), isEmpty, reason: 'no card on Requests');
    });

    test('the leaver (R8b): on notice, the last day, the checklist, the other steps', () async {
      final raw = fixture('manager_leaver');
      final api = offboardingApi(FixtureServer([
        ('GET', '/lifecycle/manager/leavers/', 'manager_leaver'),
        ('PUT', '/lifecycle/manager/leavers/', 'manager_leaver_handover_put'),
        ('POST', '/lifecycle/manager/leavers/', 'manager_leaver_handover_done'),
      ]), id: 'mgr', name: 'Meera Iyer');
      final v = await api.fetchLeaver('ravi');
      expect(v.onNotice, isTrue);
      expect(v.tl, DateTime.parse(raw['tl'] as String));
      expect(v.daysLeft, raw['daysLeft']);
      expect(v.acceptedAt, isNotNull);
      expect(v.resignation!.accepted, isTrue);
      expect([v.resignation!.reason, v.resignation!.note], ['Better opportunity', 'Thank you for three great years.']);
      expect(v.resignation!.submittedAt, isNotNull, reason: 'the notice card counts weeks from it');
      expect(v.handover.items.map((i) => i.title), ['Design system file', 'Open projects', 'Vendor list']);
      expect(v.handover.uploadedCount, 2);
      expect(v.handover.items.first.upload!.isLink, isTrue);
      expect(v.handover.items.first.upload!.label, 'docs.example/design-system');
      expect(v.handover.note, 'Please share by Friday.');
      expect(v.handover.addedAt, isNotNull);
      expect(v.handover.dueAt, isNotNull);
      expect(v.handover.done, isFalse);
      expect(v.otherSteps.map((s) => s.title), ['Laptop and accessories returned', 'ID card and access cards returned', 'Advances and loans cleared']);
      expect(v.otherSteps.map((s) => s.helper), ['Tracked by IT', 'Tracked by Admin', 'Tracked by Finance']);
      expect(v.otherSteps.every((s) => !s.done && s.title.isNotEmpty), isTrue);
      expect(jsonEncode(raw), isNot(contains('Paise')), reason: 'never an amount');
      await api.saveHandover('ravi', items: ['a'], note: 'n');
      final put = off.LeaverView.fromJson(fixture('manager_leaver_handover_put'));
      expect(put.handover.items, hasLength(3));
      expect(put.handover.items.every((i) => !i.uploaded), isTrue);
      await api.markHandoverDone('ravi');
      final done = off.LeaverView.fromJson(fixture('manager_leaver_handover_done'));
      expect(done.handover.done, isTrue);
      expect(done.handover.doneAt, isNotNull);
      expect(done.otherSteps, hasLength(3));
      final before = off.LeaverView.fromJson(fixture('manager_leaver_before_checklist'));
      expect(before.onNotice, isTrue);
      expect(before.handover.items, isEmpty);
      expect(before.handover.addedAt, isNull);
    });

    test('a leaver with no resignation (an exit HR started) is still on notice', () {
      final raw = fixture('manager_leaver')..remove('resignation');
      raw.remove('tl');
      raw.remove('daysLeft');
      raw.remove('acceptedAt');
      final v = off.LeaverView.fromJson(raw);
      expect(v.onNotice, isTrue);
      expect(v.tl, DateTime.parse(raw['status']['tl'] as String), reason: 'read from the exit’s own status');
      expect(v.daysLeft, raw['status']['daysLeft']);
      expect(v.acceptedAt, isNotNull);
    });
  });

  // ─────────────────────────────────────────────────────────────── the Off-boarding page
  group('offboarding: the page (R3)', () {
    test('before the checklist, and with it', () async {
      final empty = await offboardingApi(FixtureServer([('GET', '/lifecycle/offboarding', 'offboarding_get_before_checklist')])).fetchOffboarding();
      expect(empty.handover.items, isEmpty);
      expect(empty.tl, isNotNull);

      final raw = fixture('offboarding_get');
      final page = await offboardingApi(FixtureServer([('GET', '/lifecycle/offboarding', 'offboarding_get')])).fetchOffboarding();
      expect(page.tl, DateTime.parse(raw['tl'] as String));
      expect(page.daysLeft, raw['daysLeft']);
      expect(page.managerName, 'Meera Iyer');
      expect(page.acceptedAt, isNotNull);
      expect(page.noticeFrom, DateTime.parse(raw['noticeFrom'] as String));
      expect(page.task('upload_handover'), isNotNull);
      expect(page.task('exit_interview'), isNotNull);
      expect(page.task('save_documents'), isNotNull);
      expect(page.tasks.every((t) => t.title.isNotEmpty && t.id.isNotEmpty), isTrue);
      expect(page.handover.items.map((i) => i.title), ['Design system file', 'Open projects', 'Vendor list']);
      expect(page.handover.uploadedCount, 2);
      expect(page.handover.note, 'Please share by Friday.');
      expect(page.handover.dueAt, isNotNull);
      expect(page.handover.addedAt, isNotNull);
      expect(page.interview.open, isTrue);
      expect(page.interview.sent, isFalse);
      expect(page.interview.opensAt, DateTime.parse(raw['interview']['opensAt'] as String));
      expect(page.documents.map((d) => d.kind), ['payslip', 'form16']);
      expect(page.documents.every((d) => d.label.isNotEmpty), isTrue);
      final sent = off.OffboardingPageData.fromJson(fixture('offboarding_get_after_interview'));
      expect(sent.interview.sent, isTrue);
      expect(sent.interview.open, isFalse);
      expect(sent.task('exit_interview')!.done, isTrue);
    });

    test('handing over: a link, a file, removing it', () async {
      final api = offboardingApi(FixtureServer([
        ('POST', '/lifecycle/offboarding/handover/', 'handover_upload_file'),
        ('DELETE', '/lifecycle/offboarding/handover/', 'handover_remove'),
      ]));
      final link = off.HandoverItem.fromJson((fixture('handover_upload_link')['item'] as Map).cast<String, dynamic>());
      expect(link.uploaded, isTrue);
      expect(link.upload!.isLink, isTrue);
      expect(link.upload!.url, 'https://docs.example/design-system');
      final file = await api.uploadHandoverFile('i2', fileName: 'open-projects.pdf', bytes: Uint8List.fromList(utf8.encode('%PDF-1.4')));
      expect(file.title, 'Open projects');
      expect(file.upload!.isLink, isFalse);
      expect(file.upload!.label, 'open-projects.pdf');
      expect(file.upload!.at, isNotNull);
      await api.removeHandoverUpload('i2');
      final removed = off.HandoverItem.fromJson((fixture('handover_remove')['item'] as Map).cast<String, dynamic>());
      expect(removed.uploaded, isFalse);
    });

    test('the exit interview: the app’s answers are what the server keeps', () async {
      final server = FixtureServer([('POST', '/lifecycle/offboarding/interview', 'exit_interview_post')]);
      await offboardingApi(server).sendExitInterview(const off.ExitInterviewAnswers(reason: 'growth', workingHere: 4, manager: 5, comeBack: 'maybe', change: 'x'));
      expect(server.calls, ['POST /lifecycle/offboarding/interview']);
      expect(fixture('exit_interview_post')['sent'], isTrue);
    });
  });

  // ─────────────────────────────────────────────────────────────── an exit HR started; the manager's leavers
  group('offboarding: an exit HR started', () {
    test('the leaver: no resignation, the notice tab (R2b) and the page, its type', () async {
      final server = FixtureServer([
        ('GET', '/lifecycle/me', 'me_hr_started'),
        ('GET', '/lifecycle/resignation', 'resignation_get_hr_started'),
        ('GET', '/lifecycle/manager/', 'manager_resignations_accepted'),
        ('GET', '/lifecycle/offboarding', 'offboarding_get_hr_started'),
      ]);
      off.OffboardingApi.testOverride = (s) => off.OffboardingApi(session: s, baseUrl: _base, client: server.client);
      addTearDown(() {
        off.OffboardingApi.testOverride = null;
        off.OffboardingStore.reset();
      });
      off.OffboardingStore.reset();
      final store = off.OffboardingStore.of(session('p2', 'Tara Bose'));
      await store.ensureLoaded();
      expect(store.resignation, isNull);
      expect(store.onNotice, isTrue);
      expect(store.exitWithoutResignation, isTrue);
      expect(store.showsResignationTab, isTrue, reason: 'countdown in R2b');
      expect(store.resignationTabLabel, 'Exit');
      expect(store.canResign, isFalse);
      final page = await store.api.fetchOffboarding();
      expect(page.exitType, 'retirement');
      expect(off.exitTypeLabel(page.exitType), 'Retirement');
      expect(page.tl, day(fixture('me_hr_started')['offboarding']['tl']));
      expect(page.acceptedAt, isNotNull);
    });

    test('the manager: the leavers list carries HR-started exits, and their R8b has no resignation', () async {
      final leavers = await offboardingApi(FixtureServer([('GET', '/lifecycle/manager/leavers', 'manager_leavers')]), id: 'mgr', name: 'Meera Iyer').fetchManagerLeavers();
      expect(leavers.map((l) => l.userId), containsAll(['p2', 'ravi']));
      final tara = leavers.firstWhere((l) => l.userId == 'p2');
      expect([tara.name, tara.tl, tara.daysLeft], ['Tara Bose', day(fixture('me_hr_started')['offboarding']['tl']), 20]);
      final ravi = leavers.firstWhere((l) => l.userId == 'ravi');
      expect([ravi.handoverItems, ravi.handoverUploaded], [3, 2]);
      final v = off.LeaverView.fromJson(fixture('manager_leaver_hr_started'));
      expect(v.resignation, isNull);
      expect(v.onNotice, isTrue);
      expect(v.exitType, 'retirement');
      expect(v.tl, tara.tl);
    });

    test('R1 offers the server\'s reasons', () {
      final s = off.ResignationState.fromJson(fixture('resignation_get_none'));
      expect(s.reasons, containsAll(['Better opportunity', 'Manager', 'Other']));
    });
  });

  // ─────────────────────────────────────────────────────────────── pushes
  group('pushes', () {
    final pushes = [for (final p in fixture('push_payloads')['pushes'] as List) (p as Map).cast<String, dynamic>()];

    bool leaving(Map<String, dynamic> p) => const {'lifecycle_offboarding', 'lifecycle_resignation'}.contains((p['data'] as Map)['type']);

    test('every onboarding push names a destination the app opens, with the ids it needs', () {
      final onboarding = pushes.where((p) => (p['data'] as Map)['destination'] != null && !leaving(p)).toList();
      expect(onboarding, isNotEmpty);
      for (final p in onboarding) {
        final data = (p['data'] as Map).cast<String, dynamic>();
        final destination = data['destination'] as String;
        expect(onboardingDestinations, contains(destination), reason: '${p['scenario']}');
        expect(data['journeyId'], isA<String>(), reason: '${p['scenario']} carries its journey');
        if (destination == 'lifecycle_meeting') expect(data['meetingId'], isA<String>());
        if (destination == 'lifecycle_starter_task_done') expect(data['starterTaskId'], isA<String>());
        if (destination == 'lifecycle_probation_review') expect(data['month'], isNotNull);
        expect('${p['title']}', isNotEmpty);
        expect('${p['body']}', isNotEmpty);
      }
      final starter = onboarding.firstWhere((p) => p['scenario'] == 'lifecycle_starter_task');
      expect(starter['data']['starterTaskId'], fixture('starter_tasks_get')['tasks'][0]['id']);
    });

    test('every offboarding push names where it opens, with its ids, and is never an onboarding screen', () {
      final offboarding = pushes.where(leaving).toList();
      expect(offboarding.length, greaterThanOrEqualTo(8));
      expect(pushes.where((p) => RegExp('resign|offboard|handover|exit_interview').hasMatch(p['scenario'] as String)).every(leaving), isTrue);
      for (final p in offboarding) {
        final data = (p['data'] as Map).cast<String, dynamic>();
        final destination = data['destination'] as String?;
        expect(off.offboardingPushDestinations, contains(destination), reason: '${p['scenario']}');
        expect(onboardingDestinations, isNot(contains(destination)), reason: 'not opened as an onboarding screen');
        expect(off.OffboardingStore.isOffboardingPush(data), isTrue);
        if (destination == 'lifecycle_resignation_request') {
          expect([data['resignationId'], data['userId']], everyElement(isA<String>()), reason: '${p['scenario']}');
        }
        if (destination == 'lifecycle_leaver') expect(data['userId'], isA<String>(), reason: '${p['scenario']}');
        if (destination == 'lifecycle_resignation') {
          expect(data['resignationId'] ?? data['journeyId'], isA<String>(), reason: '${p['scenario']}');
        }
      }
      String where(String scenario) => '${offboarding.firstWhere((p) => p['scenario'] == scenario)['data']['destination']}';
      expect(where('lifecycle_resignation'), 'lifecycle_resignation_request');
      expect(where('lifecycle_resignation_withdrawn'), 'lifecycle_resignation_request');
      expect(where('lifecycle_resignation_with_hr'), 'lifecycle_resignation');
      expect(where('lifecycle_offboarding_open'), 'lifecycle_resignation');
      expect(where('lifecycle_handover_checklist'), 'lifecycle_leaver');
      expect(where('lifecycle_handover_shared'), 'lifecycle_handover');
      expect(where('lifecycle_handover_uploaded'), 'lifecycle_leaver');
      expect(where('lifecycle_exit_interview_open'), 'lifecycle_exit_interview');
    });

    test('the app routes each offboarding push the server sends', () async {
      Future<List<String>> route(String userId, List<(String, String, String)> routes, Iterable<Map<String, dynamic>> sent) async {
        final server = FixtureServer(routes);
        off.OffboardingApi.testOverride = (s) => off.OffboardingApi(session: s, baseUrl: _base, client: server.client);
        addTearDown(() {
          off.OffboardingApi.testOverride = null;
          off.OffboardingStore.reset();
        });
        off.OffboardingStore.reset();
        final store = off.OffboardingStore.of(session(userId, userId));
        final opened = <String>[];
        final routes0 = off.OffboardingRoutes(
          openRequests: (id) => opened.add('requests:$id'),
          openOwnResignation: () => opened.add('own-resignation'),
          openOffboarding: ({section}) => opened.add('offboarding:${section ?? ''}'),
          openLeaver: (id) => opened.add('leaver:$id'),
          openElsewhere: () => opened.add('elsewhere'),
        );
        for (final p in sent) {
          expect(off.openOffboardingDestination((p['data'] as Map).cast<String, dynamic>(), store, routes0), isTrue);
          await store.refresh();
          await Future<void>.delayed(Duration.zero);
        }
        return opened;
      }

      final toRavi = pushes.where((p) => leaving(p) && p['userId'] == 'ravi').toList();
      final ravi = await route('ravi', [
        ('GET', '/lifecycle/me', 'me_on_notice'),
        ('GET', '/lifecycle/resignation', 'resignation_get_accepted'),
        ('GET', '/lifecycle/manager/', 'manager_resignations_accepted'),
      ], toRavi);
      expect(ravi, [
        for (final p in toRavi)
          switch (p['scenario']) {
            'lifecycle_handover_shared' => 'offboarding:handover',
            'lifecycle_exit_interview_open' => 'offboarding:exit_interview',
            _ => 'own-resignation',
          },
      ]);
      final toMeera = pushes.where((p) => leaving(p) && p['userId'] == 'mgr').toList();
      final meera = await route('mgr', [
        ('GET', '/lifecycle/me', 'me_joiner'),
        ('GET', '/lifecycle/resignation', 'resignation_get_none'),
        ('GET', '/lifecycle/manager/resignations', 'manager_resignations_accepted'),
        ('GET', '/lifecycle/manager/leavers', 'manager_leavers'),
      ], toMeera);
      expect(meera, [
        for (final p in toMeera)
          p['data']['destination'] == 'lifecycle_resignation_request'
              ? 'requests:${p['data']['resignationId']}'
              : 'leaver:${p['data']['userId']}',
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────── the account closes (R6)
  group('the account closed (R6)', () {
    Future<off.AccountClosedInfo?> refused(String name, Future<void> Function(AuthApiService api) call, String email) async {
      final api = AuthApiService(baseUrl: _base, client: FixtureServer([('POST', '/auth/', name), ('GET', '/auth/', name)]).client);
      try {
        await call(api);
      } on AuthApiException catch (error) {
        return off.accountClosedFor(statusCode: error.statusCode, message: error.message, body: error.body, email: email);
      }
      fail('$name was not refused');
    }

    test('sign-in for an ended account: the company, the last day, where to write', () async {
      final info = await refused('auth_request_otp_closed', (api) => api.requestOtp('ravi@fixture.test'), 'ravi@fixture.test');
      expect(info, isNotNull);
      expect(info!.companyName, 'Fixture Works');
      expect(info.lastDay, DateTime.parse(fixture('me_on_notice')['offboarding']['tl'] as String));
      expect(info.hrEmail, 'people@fixture.test');
    });

    test('the profile check (and a session that outlived the account) say the same', () async {
      for (final name in ['auth_me_closed', 'auth_session_closed']) {
        final info = await refused(name, (api) => api.fetchCurrentUser('t'), 'ravi@fixture.test');
        expect(info?.companyName, 'Fixture Works', reason: name);
        expect(info?.hrEmail, 'people@fixture.test', reason: name);
        expect(info?.lastDay, isNotNull, reason: name);
      }
    });

    test('nothing for an unknown email, or where the lifecycle is off', () async {
      expect(await refused('auth_request_otp_unknown', (api) => api.requestOtp('nobody@fixture.test'), 'nobody@fixture.test'), isNull);
      expect(await refused('auth_request_otp_closed_lifecycle_off', (api) => api.requestOtp('olga@fixture.test'), 'olga@fixture.test'), isNull);
      expect(fixture('auth_request_otp_unknown')['body'], isNot(contains('accountClosed')));
      expect(fixture('auth_request_otp_closed_lifecycle_off')['body'], isNot(contains('accountClosed')));
      final closed = (fixture('auth_request_otp_closed')['body'] as Map)['accountClosed'] as Map;
      expect(closed.keys.toSet(), {'company', 'lastWorkingDay', 'hrEmail'}, reason: 'nothing more than the three');
    });
  });
}
