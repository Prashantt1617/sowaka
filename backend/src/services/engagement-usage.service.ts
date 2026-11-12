/**
 * Dashboard › Engagement › App usage: who is on the app, how far they have set
 * it up, and what they do in it, for one org and a From–To range.
 *
 * Every count is worked out in Mongo per collection (a distinct set of people
 * per question), so the page gets one compact row per person with yes/no
 * answers rather than the rows behind them. The dashboard filters those by
 * department and location and does its own counting, which is instant.
 *
 * Opening the app is only known from `appActivity`, which started filling on
 * the day it shipped: days before the org's first row are "not tracked", never
 * zero, and the answer says when tracking started so the page can say so.
 */
import type { Document } from 'mongodb';
import {
  attendanceRecords,
  attendanceRegularizations,
  connectPosts,
  feedbackRecords,
  gameChallenges,
  gameScores,
  getDb,
  investmentProofs,
  leaves,
  notifications,
  overtimeRequests,
  reimbursementClaims,
  relayEvents,
  relayPresence,
  users,
} from '../config/db';
import type { User } from '../models/user.model';
import type { PunchFormat } from '../models/shift.model';
import { AdminError } from './admin.service';
import { appActivity } from './app-activity.service';
import { missedPunchPeople } from './attendance-report.service';
import { cachedEngagement } from './engagement-cache';
import { getCompanyConfig } from './company-settings.service';
import { cupMatches } from './cup.service';
import { notifiesOrg, notifyUsers } from './notification.service';
import { pointEvents } from './points-ledger.service';
import { pokerResults } from './poker-db';
import { policiesForPeople } from './shift.service';
import { squadPayouts } from './secret-squad.service';

export type UsageGroup = 'app' | 'bio' | 'present';

/** One person, as the page needs them. Flags are for the range asked about unless noted. */
export type UsagePerson = {
  id: string;
  name: string;
  dept: string;
  loc: string;
  /** Their manager's user id, '' at the top of the tree. */
  mgr: string;
  group: UsageGroup;
  /** Direct reports who are on the roll. */
  reports: number;
  // Profile, as it stands today.
  loggedIn: boolean;
  /** Last sign-in, ISO; null if never. */
  lastLoginAt: string | null;
  photo: boolean;
  interests: boolean;
  face: boolean;
  /** Latest day they opened the app (any day, not only the range); null if never since tracking began. */
  lastOpen: string | null;
  opened: boolean;
  game: boolean;
  post: boolean;
  contest: boolean;
  tour: boolean;
  /** Punched in on the app (a punch with a location) in the range. */
  appPunch: boolean;
  /** Had a missed punch in the range, or asked to fix one. */
  missed: boolean;
  /** Asked to fix a missed punch in the range. */
  fixed: boolean;
  /** Has a manager, which leave, overtime and reimbursement all need. */
  hasManager: boolean;
  /** May claim overtime: their shift, their own flag and their department all allow it. */
  otEligible: boolean;
  leave: boolean;
  ot: boolean;
  reimb: boolean;
  /** Decided at least one of their team's requests on the app. */
  decidedOnApp: boolean;
  /** Sent at least one feedback review. */
  review: boolean;
  payslips: boolean;
  payroll: boolean;
  proofs: boolean;
};

export type UsageManager = { id: string; got: number; app: number; web: number; wait: number };

export type UsageSummary = {
  from: string;
  to: string;
  today: string;
  /** Earliest day the org has app activity for; null when nothing is recorded yet. */
  trackingSince: string | null;
  /** False when the missed-punch count could not be graded for this range. */
  missedKnown: boolean;
  people: UsagePerson[];
  /** Per manager: their team's leave, overtime and attendance-fix requests raised in the range. */
  managers: UsageManager[];
  departments: string[];
  locations: string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Today in IST, the day `appActivity` keys by. */
function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The instants an IST day range covers, for fields stored as a Date. */
function istSpan(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS),
    end: new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS - IST_OFFSET_MS - 1),
  };
}

function readRange(input: { from?: unknown; to?: unknown }): { from: string; to: string } {
  const from = typeof input.from === 'string' ? input.from : '';
  const to = typeof input.to === 'string' ? input.to : '';
  if (!DATE.test(from) || !DATE.test(to)) throw new AdminError(400, 'from and to must be YYYY-MM-DD');
  if (from > to) throw new AdminError(400, 'from must not be after to');
  if (Date.parse(to) - Date.parse(from) > 366 * DAY_MS) throw new AdminError(400, 'Pick a range of a year or less');
  return { from, to };
}

function groupOf(format: PunchFormat | undefined): UsageGroup {
  if (format === 'Geotag (powered by Sowaka)' || format === 'In-app punch in') return 'app';
  if (format === 'Present by default (Auto Punch)') return 'present';
  return 'bio';
}

type RosterRow = Pick<
  User,
  'userId' | 'name' | 'org' | 'department' | 'location' | 'branch' | 'managerUserId' | 'lastLoginAt' | 'profilePhotoKey' | 'interests' | 'faceId' | 'overtimeEligible' | 'employeeId'
> & { hasLegacyPhoto?: boolean };

/** Everyone on the roll in the org: not offboarded, not a service account. */
async function rosterOf(org: string): Promise<RosterRow[]> {
  // The legacy photo is an inline data URI hundreds of KB long: ask only whether it is there.
  return users()
    .aggregate<RosterRow>([
      { $match: { org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true } } },
      {
        $project: {
          _id: 0, userId: 1, name: 1, org: 1, department: 1, location: 1, branch: 1, managerUserId: 1, lastLoginAt: 1,
          profilePhotoKey: 1, interests: 1, overtimeEligible: 1, employeeId: 1,
          faceId: { $cond: [{ $ifNull: ['$faceId.faceId', false] }, { faceId: '$faceId.faceId' }, '$$REMOVE'] },
          hasLegacyPhoto: { $gt: [{ $strLenBytes: { $ifNull: ['$profilePhotoUrl', ''] } }, 0] },
        },
      },
    ])
    .toArray();
}

/** Distinct values of `field` over the rows `match` finds. */
async function distinctOf(col: { aggregate: (p: Document[]) => { toArray: () => Promise<Document[]> } }, match: Document, field = '$userId'): Promise<Set<string>> {
  const rows = await col.aggregate([{ $match: match }, { $group: { _id: field } }]).toArray();
  return new Set(rows.map((r) => String(r._id)).filter(Boolean));
}

/** The App usage page for a range, remembered for a few minutes (see engagement-cache). */
export async function usageSummary(caller: { userId: string; org: string }, input: { from?: unknown; to?: unknown }): Promise<UsageSummary> {
  const { from, to } = readRange(input);
  const today = istToday();
  return cachedEngagement(caller.org, 'usage-summary', { from, to, today }, () => buildUsageSummary(caller.org, from, to, today));
}

async function buildUsageSummary(org: string, from: string, to: string, today: string): Promise<UsageSummary> {
  const { start, end } = istSpan(from, to);
  const roster = await rosterOf(org);
  const ids = roster.map((u) => u.userId);
  const inRoster = { $in: ids };

  const activity = appActivity();
  const [
    policies, company, firstDay, lastOpenRows, openedRows,
    punchers, fixers, leaveBy, otBy, reimbBy, reviewers, proofers, posters,
    approvals, missedUsers, played, contested, toured,
  ] = await Promise.all([
    policiesForPeople(roster.map((u) => ({ userId: u.userId, org: u.org })), to < today ? to : today),
    getCompanyConfig(org),
    activity.find({ org }, { projection: { _id: 0, day: 1 } }).sort({ day: 1 }).limit(1).toArray(),
    activity.aggregate<{ _id: string; last: string }>([
      { $match: { org, day: { $lte: today } } },
      { $group: { _id: '$userId', last: { $max: '$day' } } },
    ]).toArray(),
    activity.aggregate<{ _id: string; did: string[][] }>([
      { $match: { org, day: { $gte: from, $lte: to } } },
      { $group: { _id: '$userId', did: { $addToSet: '$did' } } },
    ]).toArray(),
    // An app punch carries the device's location; imported and auto days do not.
    distinctOf(attendanceRecords(), { userId: inRoster, workDate: { $gte: from, $lte: to }, punchInLocation: { $exists: true } }),
    // Rows written before out-of-location requests existed have no kind: corrections.
    distinctOf(attendanceRegularizations(), { userId: inRoster, createdAt: { $gte: start, $lte: end }, $or: [{ kind: 'correction' }, { kind: { $exists: false } }] }),
    // Leave stamps createdAt as epoch milliseconds; a Date is accepted too.
    distinctOf(leaves(), { userId: inRoster, $or: [{ createdAt: { $gte: start.getTime(), $lte: end.getTime() } }, { createdAt: { $gte: start, $lte: end } }] }),
    distinctOf(overtimeRequests(), { userId: inRoster, createdAt: { $gte: start, $lte: end } }),
    distinctOf(reimbursementClaims(), { userId: inRoster, createdAt: { $gte: start, $lte: end } }),
    reviewersIn(ids, start, end),
    proofUploadersIn(org, ids, start, end),
    postersIn(org, ids, start, end),
    approvalsIn(roster, start, end),
    missedPunchUsers(org, from, to < today ? to : today),
    gamePlayersIn(org, ids, start, end),
    contestantsIn(org, ids, start, end),
    tournamentPlayersIn(org, ids, start, end),
  ]);

  const lastOpen = new Map(lastOpenRows.map((r) => [r._id, r.last]));
  const opened = new Map(openedRows.map((r) => [r._id, new Set(r.did.flat())]));
  const reports = new Map<string, number>();
  for (const u of roster) if (u.managerUserId) reports.set(u.managerUserId, (reports.get(u.managerUserId) ?? 0) + 1);
  const onRoll = new Set(ids);
  const disabledDepts = new Set(company.overtimeDisabledDepartments);

  const people: UsagePerson[] = roster.map((u) => {
    const policy = policies.get(u.userId);
    const did = opened.get(u.userId);
    const hasManager = Boolean(u.managerUserId && onRoll.has(u.managerUserId));
    const raisedFix = fixers.has(u.userId);
    return {
      id: u.userId,
      name: u.name || u.employeeId || 'Unnamed',
      dept: u.department?.trim() || '—',
      loc: (u.location ?? u.branch)?.trim() || '—',
      mgr: u.managerUserId ?? '',
      group: groupOf(policy?.correction?.punchFormat),
      reports: reports.get(u.userId) ?? 0,
      loggedIn: Boolean(u.lastLoginAt) || lastOpen.has(u.userId),
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
      photo: Boolean(u.profilePhotoKey) || Boolean(u.hasLegacyPhoto),
      interests: Array.isArray(u.interests) && u.interests.length > 0,
      face: Boolean(u.faceId?.faceId),
      lastOpen: lastOpen.get(u.userId) ?? null,
      opened: Boolean(did),
      game: played.has(u.userId),
      post: posters.has(u.userId),
      contest: contested.has(u.userId),
      tour: toured.has(u.userId),
      appPunch: punchers.has(u.userId),
      missed: (missedUsers?.has(u.userId) ?? false) || raisedFix,
      fixed: raisedFix,
      hasManager,
      otEligible:
        hasManager &&
        policy?.overtime?.eligible !== false &&
        u.overtimeEligible !== false &&
        !disabledDepts.has((u.department ?? '').trim()),
      leave: leaveBy.has(u.userId),
      ot: otBy.has(u.userId),
      reimb: reimbBy.has(u.userId),
      decidedOnApp: approvals.decidedOnApp.has(u.userId),
      review: reviewers.has(u.userId),
      payslips: did?.has('payslips') ?? false,
      payroll: did?.has('payroll') ?? false,
      proofs: proofers.has(u.userId),
    };
  });

  return {
    from,
    to,
    today,
    trackingSince: firstDay[0]?.day ?? null,
    missedKnown: missedUsers !== null,
    people,
    managers: approvals.managers,
    departments: [...new Set(people.map((p) => p.dept))].sort(),
    locations: [...new Set(people.map((p) => p.loc))].sort(),
  };
}

// ── period questions, one distinct set each ───────────────────────────────

/** Anyone with a missed punch in the range, as Reports › Attendance grades it. Null if it could not be graded. */
async function missedPunchUsers(org: string, from: string, to: string): Promise<Set<string> | null> {
  // The report's own grading, asked only who had a missed punch or an
  // unmarked absence: no report is built, and punch rows are read lean.
  return missedPunchPeople(org, from, to).catch(() => null);
}

/**
 * Approvals: each manager's team requests raised in the range (leave,
 * overtime, attendance fixes) and where they were settled. A manager decides
 * from the app ('manager'); 'admin' is a decision on the web dashboard, by HR
 * or by anyone with dashboard access. Reimbursements are left out: they are
 * only ever decided on the dashboard, so they say nothing about the app.
 */
async function approvalsIn(roster: RosterRow[], start: Date, end: Date): Promise<{ managers: UsageManager[]; decidedOnApp: Set<string> }> {
  const ids = roster.map((u) => u.userId);
  const managerOf = new Map(roster.map((u) => [u.userId, u.managerUserId ?? '']));
  const facet = (managerField: string | null) => [
    {
      $group: {
        _id: managerField ?? '$userId',
        got: { $sum: 1 },
        app: { $sum: { $cond: [{ $eq: ['$decidedByRole', 'manager'] }, 1, 0] } },
        web: { $sum: { $cond: [{ $eq: ['$decidedByRole', 'admin'] }, 1, 0] } },
        wait: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
      },
    },
  ];
  type Row = { _id: string; got: number; app: number; web: number; wait: number };
  const decidedMatch = { decidedByRole: 'manager', decidedAt: { $gte: start, $lte: end } };
  const [leaveRows, otRows, fixRows, deciders] = await Promise.all([
    // A leave has no approver field: its approver is the requester's manager.
    leaves().aggregate<Row>([
      { $match: { userId: { $in: ids }, status: { $ne: 'cancelled' }, $or: [{ createdAt: { $gte: start.getTime(), $lte: end.getTime() } }, { createdAt: { $gte: start, $lte: end } }] } },
      ...facet(null),
    ]).toArray(),
    overtimeRequests().aggregate<Row>([{ $match: { userId: { $in: ids }, createdAt: { $gte: start, $lte: end } } }, ...facet('$managerUserId')]).toArray(),
    attendanceRegularizations().aggregate<Row>([{ $match: { userId: { $in: ids }, createdAt: { $gte: start, $lte: end } } }, ...facet('$managerUserId')]).toArray(),
    Promise.all([
      distinctOf(leaves(), { userId: { $in: ids }, ...decidedMatch }, '$decidedByUserId'),
      distinctOf(overtimeRequests(), { userId: { $in: ids }, ...decidedMatch }, '$decidedByUserId'),
      distinctOf(attendanceRegularizations(), { userId: { $in: ids }, ...decidedMatch }, '$decidedByUserId'),
    ]),
  ]);
  const by = new Map<string, UsageManager>();
  const add = (managerId: string, r: Row) => {
    if (!managerId) return;
    const m = by.get(managerId) ?? { id: managerId, got: 0, app: 0, web: 0, wait: 0 };
    m.got += r.got;
    m.app += r.app;
    m.web += r.web;
    m.wait += r.wait;
    by.set(managerId, m);
  };
  for (const r of leaveRows) add(managerOf.get(r._id) ?? '', r);
  for (const r of [...otRows, ...fixRows]) add(r._id, r);
  const decidedOnApp = new Set<string>();
  for (const set of deciders) for (const id of set) decidedOnApp.add(id);
  return { managers: [...by.values()].sort((a, b) => b.got - a.got), decidedOnApp };
}

// ── when and how often the app is opened ──────────────────────────────────

/** The roster narrowed to a department and a location ('' or 'All' for any). */
async function filteredPeople(org: string, input: { dept?: unknown; loc?: unknown }, asOf: string) {
  const dept = typeof input.dept === 'string' && input.dept !== 'All' ? input.dept : '';
  const loc = typeof input.loc === 'string' && input.loc !== 'All' ? input.loc : '';
  const roster = (await rosterOf(org)).filter(
    (u) => (!dept || (u.department?.trim() || '—') === dept) && (!loc || ((u.location ?? u.branch)?.trim() || '—') === loc),
  );
  const policies = await policiesForPeople(roster.map((u) => ({ userId: u.userId, org: u.org })), asOf);
  return roster.map((u) => ({ id: u.userId, group: groupOf(policies.get(u.userId)?.correction?.punchFormat) }));
}

export type UsageWhen = {
  from: string;
  to: string;
  trackingSince: string | null;
  /** People who had the app open in each IST hour, added up across the days. */
  hours: number[];
  /** People who opened the app on each weekday, added up across the days; Monday first. */
  weekdays: number[];
  /** Days in the range that were tracked (on or after tracking began, up to today). */
  trackedDays: number;
};

export async function usageWhen(org: string, input: { from?: unknown; to?: unknown; dept?: unknown; loc?: unknown }): Promise<UsageWhen> {
  const { from, to } = readRange(input);
  const today = istToday();
  const params = { from, to, today, dept: input.dept ?? '', loc: input.loc ?? '' };
  return cachedEngagement(org, 'usage-when', params, () => buildUsageWhen(org, { ...input, from, to }, today));
}

async function buildUsageWhen(org: string, input: { from: string; to: string; dept?: unknown; loc?: unknown }, today: string): Promise<UsageWhen> {
  const { from, to } = input;
  const [people, firstDay] = await Promise.all([
    filteredPeople(org, input, to < today ? to : today),
    appActivity().find({ org }, { projection: { _id: 0, day: 1 } }).sort({ day: 1 }).limit(1).toArray(),
  ]);
  const trackingSince = firstDay[0]?.day ?? null;
  const match = { org, day: { $gte: from, $lte: to }, userId: { $in: people.map((p) => p.id) } };
  const [hourRows, dayRows] = await Promise.all([
    appActivity().aggregate<{ _id: number; n: number }>([
      { $match: match },
      { $unwind: '$hours' },
      { $group: { _id: '$hours', n: { $sum: 1 } } },
    ]).toArray(),
    appActivity().aggregate<{ _id: number; n: number }>([
      { $match: match },
      // ISO weekday: 1 = Monday … 7 = Sunday.
      { $group: { _id: { $isoDayOfWeek: { $dateFromString: { dateString: '$day' } } }, n: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of hourRows) if (r._id >= 0 && r._id < 24) hours[r._id] = r.n;
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const r of dayRows) if (r._id >= 1 && r._id <= 7) weekdays[r._id - 1] = r.n;
  let trackedDays = 0;
  if (trackingSince) {
    const a = from > trackingSince ? from : trackingSince;
    const b = to < today ? to : today;
    if (a <= b) trackedDays = Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS) + 1;
  }
  return { from, to, trackingSince, hours, weekdays, trackedDays };
}

export type UsageTrendBucket = {
  from: string;
  to: string;
  /** People who opened the app in the bucket, by attendance group. */
  app: number;
  bio: number;
  present: number;
  /** Bucket wholly before tracking began, or in the future: no data, not zero. */
  untracked: boolean;
  /** Tracking began part-way through the bucket. */
  partial: boolean;
};

export type UsageTrend = {
  gran: 'date' | 'week' | 'month';
  trackingSince: string | null;
  buckets: UsageTrendBucket[];
  groups: Record<UsageGroup, number>;
};

/** Monday of the ISO week a day falls in. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export async function usageTrend(
  org: string,
  input: { from?: unknown; to?: unknown; gran?: unknown; dept?: unknown; loc?: unknown },
): Promise<UsageTrend> {
  const gran = input.gran === 'week' || input.gran === 'month' ? input.gran : 'date';
  const today = istToday();
  // Month-wise is always the last seven months, this one so far.
  const range = gran === 'month'
    ? { from: `${addMonths(today.slice(0, 7), -6)}-01`, to: today }
    : readRange(input);
  const params = { ...range, gran, today, dept: input.dept ?? '', loc: input.loc ?? '' };
  return cachedEngagement(org, 'usage-trend', params, () => buildUsageTrend(org, input, gran, range, today));
}

async function buildUsageTrend(
  org: string,
  input: { dept?: unknown; loc?: unknown },
  gran: 'date' | 'week' | 'month',
  { from, to }: { from: string; to: string },
  today: string,
): Promise<UsageTrend> {
  const [people, firstDay] = await Promise.all([
    filteredPeople(org, input, to < today ? to : today),
    appActivity().find({ org }, { projection: { _id: 0, day: 1 } }).sort({ day: 1 }).limit(1).toArray(),
  ]);
  const trackingSince = firstDay[0]?.day ?? null;
  const groupOfId = new Map(people.map((p) => [p.id, p.group]));
  const groups: Record<UsageGroup, number> = { app: 0, bio: 0, present: 0 };
  for (const p of people) groups[p.group] += 1;

  const buckets: UsageTrendBucket[] = [];
  const mk = (a: string, b: string): UsageTrendBucket => ({
    from: a, to: b, app: 0, bio: 0, present: 0,
    untracked: !trackingSince || b < trackingSince || a > today,
    partial: Boolean(trackingSince && a < trackingSince && b >= trackingSince),
  });
  if (gran === 'date') for (let d = from; d <= to; d = addDays(d, 1)) buckets.push(mk(d, d));
  else if (gran === 'week') {
    for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
      const e = addDays(w, 6);
      buckets.push(mk(w < from ? from : w, e > to ? to : e));
    }
  } else {
    for (let k = 6; k >= 0; k -= 1) {
      const m = addMonths(today.slice(0, 7), -k);
      const e = addDays(`${addMonths(m, 1)}-01`, -1);
      buckets.push(mk(`${m}-01`, e > today ? today : e));
    }
  }
  if (buckets.length > 400) throw new AdminError(400, 'Pick a shorter range');

  // Each person once per bucket: group by bucket and person in Mongo, count here by group.
  const bucketExpr = gran === 'date'
    ? '$day'
    : gran === 'month'
      ? { $substrBytes: ['$day', 0, 7] }
      : {
        $dateToString: {
          format: '%Y-%m-%d',
          // Back to the Monday: date minus (ISO weekday − 1) days, in milliseconds.
          date: { $subtract: [{ $dateFromString: { dateString: '$day' } }, { $multiply: [{ $subtract: [{ $isoDayOfWeek: { $dateFromString: { dateString: '$day' } } }, 1] }, DAY_MS] }] },
        },
      };
  const rows = await appActivity().aggregate<{ _id: { b: string; u: string } }>([
    { $match: { org, day: { $gte: from, $lte: to }, userId: { $in: people.map((p) => p.id) } } },
    { $group: { _id: { b: bucketExpr, u: '$userId' } } },
  ]).toArray();
  const index = new Map<string, UsageTrendBucket>();
  for (const b of buckets) index.set(gran === 'date' ? b.from : gran === 'month' ? b.from.slice(0, 7) : mondayOf(b.from), b);
  for (const r of rows) {
    const b = index.get(r._id.b);
    const g = groupOfId.get(r._id.u);
    if (b && g) b[g] += 1;
  }
  return { gran, trackingSince, buckets, groups };
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ── what people did: feed, contests, games, tournaments, team, payroll ────

const CONTEST_TYPES = ['caption_challenge', 'photo_story_challenge', 'most_likely'];
/** Posts the server writes on its own (celebrations, game and tournament cards). */
const AUTO_TYPES = ['birthday', 'anniversary', 'new_joinee', 'game_launch', 'live_game', 'relay_game', 'secret_squad'];

const union = (...sets: Set<string>[]) => {
  const out = new Set<string>();
  for (const set of sets) for (const id of set) out.add(id);
  return out;
};

/** People who wrote a post themselves in the range. Contests count under contests, not here. */
function postersIn(org: string, ids: string[], start: Date, end: Date): Promise<Set<string>> {
  return distinctOf(connectPosts(), {
    org,
    'author.userId': { $in: ids },
    createdAt: { $gte: start, $lte: end },
    systemKey: { $exists: false },
    type: { $nin: [...AUTO_TYPES, ...CONTEST_TYPES] },
    'author.designation': { $not: /^Auto/ },
  }, '$author.userId');
}

/**
 * Entered, voted or nominated in a contest. An entry (a Most Likely
 * nomination is one) carries its own time; a vote does not, so voters count
 * for contests that went out in the range.
 */
async function contestantsIn(org: string, ids: string[], start: Date, end: Date): Promise<Set<string>> {
  const [entrants, voters] = await Promise.all([
    connectPosts().aggregate<{ _id: string }>([
      { $match: { org, type: { $in: CONTEST_TYPES }, 'captionEntries.createdAt': { $gte: start, $lte: end } } },
      { $unwind: '$captionEntries' },
      { $match: { 'captionEntries.createdAt': { $gte: start, $lte: end }, 'captionEntries.userId': { $in: ids } } },
      { $group: { _id: '$captionEntries.userId' } },
    ]).toArray(),
    connectPosts().aggregate<{ _id: string }>([
      { $match: { org, type: { $in: CONTEST_TYPES }, publishedAt: { $gte: start, $lte: end }, captionVotes: { $exists: true } } },
      { $project: { v: { $objectToArray: '$captionVotes' } } },
      { $unwind: '$v' },
      { $match: { 'v.k': { $in: ids } } },
      { $group: { _id: '$v.k' } },
    ]).toArray(),
  ]);
  return new Set([...entrants, ...voters].map((r) => r._id));
}

/**
 * Played any game in the range. There is no one log of plays: the points
 * ledger has a row per finished Tile Up, Scribble, Pool and challenge game;
 * a hosted or catalogue game only shows when it set a new best (its score
 * row keeps the best alone); a timed launch keeps each player's best in it.
 */
async function gamePlayersIn(org: string, ids: string[], start: Date, end: Date): Promise<Set<string>> {
  const inIds = { $in: ids };
  const sets = await Promise.all([
    distinctOf(pointEvents(), { org, userId: inIds, reason: 'game', createdAt: { $gte: start, $lte: end } }),
    distinctOf(gameScores(), { org, userId: inIds, achievedAt: { $gte: start, $lte: end } }),
    distinctOf(getDb().collection('game_launch_scores'), { org, userId: inIds, achievedAt: { $gte: start, $lte: end } }),
    // A challenge someone started but has not finished is still a game played.
    gameChallenges().aggregate<{ _id: string }>([
      { $match: { org, started: { $exists: true }, createdAt: { $lte: end } } },
      { $project: { s: { $objectToArray: { $ifNull: ['$started', {}] } } } },
      { $unwind: '$s' },
      { $match: { 's.v': { $gte: start, $lte: end }, 's.k': inIds } },
      { $group: { _id: '$s.k' } },
    ]).toArray().then((rows) => new Set(rows.map((r) => r._id))),
  ]);
  return union(...sets);
}

/** Played in a tournament: joined a Cup match, sat at a Poker table, showed up for a Hint Relay, or played a Secret Squad round. */
async function tournamentPlayersIn(org: string, ids: string[], start: Date, end: Date): Promise<Set<string>> {
  const inIds = { $in: ids };
  const relayIds = (await relayEvents().find({ org }, { projection: { _id: 0, id: 1 } }).toArray()).map((e) => e.id);
  const sets = await Promise.all([
    cupMatches().aggregate<{ _id: string }>([
      { $match: { org } },
      { $project: { j: { $objectToArray: { $ifNull: ['$joined', {}] } } } },
      { $unwind: '$j' },
      { $match: { 'j.v': { $gte: start, $lte: end }, 'j.k': inIds } },
      { $group: { _id: '$j.k' } },
    ]).toArray().then((rows) => new Set(rows.map((r) => r._id))),
    distinctOf(pokerResults(), { org, userId: inIds, voided: { $ne: true }, at: { $gte: start, $lte: end } }),
    relayIds.length
      ? distinctOf(relayPresence(), { eventId: { $in: relayIds }, userId: inIds, lastSeenAt: { $gte: start, $lte: end } })
      : Promise.resolve(new Set<string>()),
    // Secret Squad: everyone a round paid points to.
    squadPayouts().find({ org, paidAt: { $gte: start, $lte: end } }, { projection: { _id: 0, points: 1 } }).toArray()
      .then((rows) => new Set(rows.flatMap((r) => Object.keys(r.points ?? {})).filter((id) => ids.includes(id)))),
  ]);
  return union(...sets);
}

/** Managers who sent a feedback review in the range (older reviews without sentAt read their last update). */
function reviewersIn(ids: string[], start: Date, end: Date): Promise<Set<string>> {
  return distinctOf(feedbackRecords(), {
    managerUserId: { $in: ids },
    status: 'sent',
    $or: [{ sentAt: { $gte: start, $lte: end } }, { sentAt: { $exists: false }, updatedAt: { $gte: start, $lte: end } }],
  }, '$managerUserId');
}

/** Uploaded an investment proof in the range (a re-upload keeps only its latest time). */
function proofUploadersIn(org: string, ids: string[], start: Date, end: Date): Promise<Set<string>> {
  return distinctOf(investmentProofs(), { org, userId: { $in: ids }, uploadedAt: { $gte: start, $lte: end } });
}

// ── a push to people who have gone quiet ──────────────────────────────────

const REMINDER_SCENARIO = 'app_usage_reminder';
const REMINDER_GAP_MS = 7 * DAY_MS;
const MAX_REMINDERS = 2000;

/**
 * One push (and inbox row) to people HR picked on the App usage page. Only
 * people of the caller's org who have signed in before get it (anyone else
 * has no phone to push to), never the caller, and nobody twice in a week, so
 * pressing the button again cannot pile reminders on anyone.
 */
export async function remindPeople(
  caller: { userId: string; org: string },
  input: { userIds?: unknown },
): Promise<{ sent: number; skipped: number }> {
  const asked = Array.isArray(input.userIds) ? [...new Set(input.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0))] : [];
  if (!asked.length) throw new AdminError(400, 'Pick at least one person');
  if (asked.length > MAX_REMINDERS) throw new AdminError(400, `At most ${MAX_REMINDERS} people at a time`);
  if (!notifiesOrg(caller.org)) throw new AdminError(409, 'Notifications are switched off for this company on this server');
  const [eligible, recent] = await Promise.all([
    users()
      .find(
        { org: caller.org, userId: { $in: asked, $ne: caller.userId }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true }, lastLoginAt: { $exists: true } },
        { projection: { _id: 0, userId: 1 } },
      )
      .toArray(),
    notifications()
      .find({ org: caller.org, scenario: REMINDER_SCENARIO, userId: { $in: asked }, createdAt: { $gte: new Date(Date.now() - REMINDER_GAP_MS) } }, { projection: { _id: 0, userId: 1 } })
      .toArray(),
  ]);
  const remindedLately = new Set(recent.map((r) => r.userId));
  const to = eligible.map((u) => u.userId).filter((id) => !remindedLately.has(id));
  if (to.length) {
    await notifyUsers(to, {
      scenario: REMINDER_SCENARIO,
      title: 'Your team is on Sowaka',
      body: 'See what’s new from your colleagues: posts, games and contests.',
      // No destination the app knows: tapping it opens the app on the feed.
      data: { destination: 'feed' },
    });
  }
  return { sent: to.length, skipped: asked.length - to.length };
}
