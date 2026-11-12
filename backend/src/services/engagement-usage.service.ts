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
  connectPosts,
  leaves,
  notifications,
  shiftAssignments,
  shiftTemplates,
  users,
} from '../config/db';
import type { User } from '../models/user.model';
import type { PunchFormat, ShiftAssignment } from '../models/shift.model';
import { AdminError } from './admin.service';
import { appActivity } from './app-activity.service';
import { missedPunchPeople } from './attendance-report.service';
import { cachedEngagement } from './engagement-cache';
import { getCompanyConfig } from './company-settings.service';
import { notifiesOrg, notifyUsers } from './notification.service';
import { getOrgShiftPolicy, policiesForPeople, resolvePolicies, type ResolvedShiftPolicy } from './shift.service';

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

/** A roster row with what grading attendance also reads, and whether the person is hidden from the directory. */
type EveryoneRow = RosterRow & Pick<User, 'state' | 'joiningDate'> & { hidden: boolean };

/** Rows per cursor round trip: the default of a hundred turns a big roster into several trips. */
const ONE_BATCH = { batchSize: 10_000 };

const ROSTER_FIELDS = {
  _id: 0, userId: 1, name: 1, org: 1, department: 1, location: 1, branch: 1, managerUserId: 1, lastLoginAt: 1,
  profilePhotoKey: 1, interests: 1, overtimeEligible: 1, employeeId: 1,
  faceId: { $cond: [{ $ifNull: ['$faceId.faceId', false] }, { faceId: '$faceId.faceId' }, '$$REMOVE'] },
  // The legacy photo is an inline data URI hundreds of KB long: ask only whether it is there.
  hasLegacyPhoto: { $gt: [{ $strLenBytes: { $ifNull: ['$profilePhotoUrl', ''] } }, 0] },
};

/** Everyone on the roll in the org: not offboarded, not a service account. */
async function rosterOf(org: string): Promise<RosterRow[]> {
  return users()
    .aggregate<RosterRow>([
      { $match: { org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true } } },
      { $project: ROSTER_FIELDS },
    ], ONE_BATCH)
    .toArray();
}

/**
 * `rosterOf` and Reports › Attendance's roster in one read: everyone not
 * offboarded, service accounts included (attendance grades them too), each
 * saying whether they are hidden from the directory.
 */
function everyoneOf(org: string): Promise<EveryoneRow[]> {
  return users()
    .aggregate<EveryoneRow>([
      { $match: { org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } },
      { $project: { ...ROSTER_FIELDS, state: 1, joiningDate: 1, hidden: { $eq: ['$hiddenFromDirectory', true] } } },
    ], ONE_BATCH)
    .toArray();
}

/** The App usage page for a range, remembered for a few minutes (see engagement-cache). */
export async function usageSummary(caller: { userId: string; org: string }, input: { from?: unknown; to?: unknown }): Promise<UsageSummary> {
  const { from, to } = readRange(input);
  const today = istToday();
  return cachedEngagement(caller.org, 'usage-summary', { from, to, today }, () => buildUsageSummary(caller.org, from, to, today));
}

/** Newest first, as `policiesForPeople` reads assignments: `effectiveFrom`, then `createdAt`, both descending. */
function newestFirst(a: ShiftAssignment, b: ShiftAssignment): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  const t = (row: ShiftAssignment) => (row.createdAt ? new Date(row.createdAt).getTime() : Number.NEGATIVE_INFINITY);
  const ta = t(a);
  const tb = t(b);
  return ta === tb ? 0 : ta < tb ? 1 : -1;
}

/**
 * Two waves of reads. First what needs only the org (the roster, the shift
 * setup, the company, app opens), then what needs the roster's ids: shift
 * assignments, the missed-punch grading's punches, and one aggregation each
 * for "requests" and "what people did", which answer every distinct-person
 * question their collections feed. The roster, templates and assignments are
 * read once, for the policies and for the missed-punch grading alike.
 */
async function buildUsageSummary(org: string, from: string, to: string, today: string): Promise<UsageSummary> {
  const { start, end } = istSpan(from, to);
  const asOf = to < today ? to : today;
  const [everyone, company, openings, orgPolicy, templates] = await Promise.all([
    everyoneOf(org),
    getCompanyConfig(org),
    openingsIn(org, from, to, today),
    getOrgShiftPolicy(org),
    shiftTemplates().find({ org }).toArray(),
  ]);
  const roster: RosterRow[] = everyone.filter((u) => !u.hidden);
  const ids = roster.map((u) => u.userId);
  const onRoll = new Set(ids);

  // One read of the assignments for both their users. The org's rows, in the
  // order Reports › Attendance reads them (the same query and sort), feed the
  // missed-punch grading; with the roll's rows written under another org they
  // feed the policies, as `policiesForPeople` reads them (by person).
  const assignments = shiftAssignments()
    .aggregate<ShiftAssignment & { elsewhere?: true }>([
      { $match: { org } },
      { $sort: { effectiveFrom: -1 } },
      { $unionWith: { coll: 'shift_assignments', pipeline: [{ $match: { userId: { $in: ids }, org: { $ne: org } } }, { $set: { elsewhere: true } }] } },
    ], ONE_BATCH)
    .toArray();
  const [assigned, missedUsers, asked, did] = await Promise.all([
    assignments,
    // The report's own grading, asked only who had a missed punch or an
    // unmarked absence: no report is built, and punch rows are read lean.
    missedPunchPeople(org, from, asOf, { roster: everyone, templates, orgPolicy, assignments: assignments.then((rows) => rows.filter((r) => !r.elsewhere)) })
      .catch(() => null),
    requestsIn(org, roster, start, end, from, to),
    doneIn(org, ids, start, end),
  ]);
  const policies = roster.length
    ? resolvePolicies(
      roster.map((u) => ({ userId: u.userId, org: u.org })),
      { policyByOrg: new Map([[org, orgPolicy]]), templates },
      assigned.filter((r) => onRoll.has(r.userId) && typeof r.effectiveFrom === 'string' && r.effectiveFrom <= asOf).sort(newestFirst),
    )
    : new Map<string, ResolvedShiftPolicy>();

  const reports = new Map<string, number>();
  for (const u of roster) if (u.managerUserId) reports.set(u.managerUserId, (reports.get(u.managerUserId) ?? 0) + 1);
  const disabledDepts = new Set(company.overtimeDisabledDepartments);
  const has = (set: Set<string> | undefined, id: string) => set?.has(id) ?? false;

  const people: UsagePerson[] = roster.map((u) => {
    const policy = policies.get(u.userId);
    const opened = openings.did.get(u.userId);
    const hasManager = Boolean(u.managerUserId && onRoll.has(u.managerUserId));
    const raisedFix = has(asked.sets.fix, u.userId);
    return {
      id: u.userId,
      name: u.name || u.employeeId || 'Unnamed',
      dept: u.department?.trim() || '—',
      loc: (u.location ?? u.branch)?.trim() || '—',
      mgr: u.managerUserId ?? '',
      group: groupOf(policy?.correction?.punchFormat),
      reports: reports.get(u.userId) ?? 0,
      loggedIn: Boolean(u.lastLoginAt) || openings.lastOpen.has(u.userId),
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
      photo: Boolean(u.profilePhotoKey) || Boolean(u.hasLegacyPhoto),
      interests: Array.isArray(u.interests) && u.interests.length > 0,
      face: Boolean(u.faceId?.faceId),
      lastOpen: openings.lastOpen.get(u.userId) ?? null,
      opened: Boolean(opened),
      game: has(did.game, u.userId),
      post: has(did.post, u.userId),
      contest: has(did.contest, u.userId),
      tour: has(did.tour, u.userId),
      appPunch: has(asked.sets.punch, u.userId),
      missed: (missedUsers?.has(u.userId) ?? false) || raisedFix,
      fixed: raisedFix,
      hasManager,
      otEligible:
        hasManager &&
        policy?.overtime?.eligible !== false &&
        u.overtimeEligible !== false &&
        !disabledDepts.has((u.department ?? '').trim()),
      leave: has(asked.sets.leave, u.userId),
      ot: has(asked.sets.ot, u.userId),
      reimb: has(asked.sets.reimb, u.userId),
      decidedOnApp: has(asked.sets.decided, u.userId),
      review: has(asked.sets.review, u.userId),
      payslips: opened?.has('payslips') ?? false,
      payroll: opened?.has('payroll') ?? false,
      proofs: has(asked.sets.proof, u.userId),
    };
  });

  return {
    from,
    to,
    today,
    trackingSince: openings.first,
    missedKnown: missedUsers !== null,
    people,
    managers: asked.managers,
    departments: [...new Set(people.map((p) => p.dept))].sort(),
    locations: [...new Set(people.map((p) => p.loc))].sort(),
  };
}

// ── period questions, one aggregation per family ──────────────────────────

/**
 * App opens in one pass over the org's `appActivity`: the day tracking began,
 * each person's latest day (up to today), and what they did on days in the range.
 */
async function openingsIn(org: string, from: string, to: string, today: string) {
  const inRange = { $and: [{ $gte: ['$day', from] }, { $lte: ['$day', to] }] };
  const rows = await appActivity().aggregate<{ _id: string; first: string | null; last: string | null; n: number; did: unknown[] }>([
    { $match: { org } },
    {
      $group: {
        _id: '$userId',
        first: { $min: '$day' },
        last: { $max: { $cond: [{ $lte: ['$day', today] }, '$day', null] } },
        n: { $sum: { $cond: [inRange, 1, 0] } },
        did: { $addToSet: { $cond: [inRange, '$did', '$$REMOVE'] } },
      },
    },
  ], ONE_BATCH).toArray();
  let first: string | null = null;
  const lastOpen = new Map<string, string>();
  const did = new Map<string, Set<unknown>>();
  for (const r of rows) {
    if (r.first != null && (first === null || r.first < first)) first = r.first;
    if (r.last != null) lastOpen.set(r._id, r.last);
    if (r.n > 0) did.set(r._id, new Set(r.did.flat()));
  }
  return { first, lastOpen, did };
}

/**
 * Several questions of one collection in one pass: a `$facet` of
 * `$group`-by-person pipelines, unwound to one row per answer, tagged `k`
 * with the question. `$facet` keeps only the groups, never the rows behind them.
 */
function facetRows(questions: Record<string, Document[]>): Document[] {
  return [
    { $facet: questions },
    { $project: { rows: { $concatArrays: Object.keys(questions).map((k) => ({ $map: { input: `$${k}`, in: { $mergeObjects: ['$$this', { k }] } } })) } } },
    { $unwind: '$rows' },
    { $replaceRoot: { newRoot: '$rows' } },
  ];
}

/** Another collection's question, as a branch of an aggregation that starts on one collection. */
const branch = (coll: string, pipeline: Document[]): Document => ({ $unionWith: { coll, pipeline } });
const tagged = (k: string): Document => ({ $set: { k } });

type Answer = { _id: unknown; k: string; got?: number; app?: number; web?: number; wait?: number };

/** Distinct people per question, keyed as `distinctOf` keys them (the `String` of the group's id). */
function setsOf(rows: Answer[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const r of rows) {
    const id = String(r._id);
    if (id) (out[r.k] ??= new Set()).add(id);
  }
  return out;
}

/**
 * Requests and what was done about them, in one aggregation over leave,
 * overtime, attendance fixes, reimbursements, reviews, proofs and app punches:
 * who asked for each, who decided their team's on the app, and per manager
 * their team's leave, overtime and attendance-fix requests raised in the range
 * and where they were settled. A manager decides from the app ('manager');
 * 'admin' is a decision on the web dashboard, by HR or by anyone with
 * dashboard access. Reimbursements are left out of that: they are only ever
 * decided on the dashboard, so they say nothing about the app.
 */
async function requestsIn(
  org: string,
  roster: RosterRow[],
  start: Date,
  end: Date,
  from: string,
  to: string,
): Promise<{ sets: Record<string, Set<string>>; managers: UsageManager[] }> {
  const inIds = { $in: roster.map((u) => u.userId) };
  const created = { createdAt: { $gte: start, $lte: end } };
  // Leave stamps createdAt as epoch milliseconds; a Date is accepted too.
  const leaveCreated = [{ createdAt: { $gte: start.getTime(), $lte: end.getTime() } }, created];
  const decided = { decidedByRole: 'manager', decidedAt: { $gte: start, $lte: end } };
  const team = (by: string) => ({
    $group: {
      _id: by,
      got: { $sum: 1 },
      app: { $sum: { $cond: [{ $eq: ['$decidedByRole', 'manager'] }, 1, 0] } },
      web: { $sum: { $cond: [{ $eq: ['$decidedByRole', 'admin'] }, 1, 0] } },
      wait: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
    },
  });
  const deciders = [{ $match: decided }, { $group: { _id: '$decidedByUserId' } }];
  const rows = await leaves().aggregate<Answer>([
    { $match: { userId: inIds, $or: [...leaveCreated, decided] } },
    ...facetRows({
      leave: [{ $match: { $or: leaveCreated } }, { $group: { _id: '$userId' } }],
      // A leave has no approver field: its approver is the requester's manager.
      leaveTeam: [{ $match: { status: { $ne: 'cancelled' }, $or: leaveCreated } }, team('$userId')],
      decided: deciders,
    }),
    branch('overtime_requests', [
      { $match: { userId: inIds, $or: [created, decided] } },
      ...facetRows({
        ot: [{ $match: created }, { $group: { _id: '$userId' } }],
        team: [{ $match: created }, team('$managerUserId')],
        decided: deciders,
      }),
    ]),
    branch('attendance_regularizations', [
      { $match: { userId: inIds, $or: [created, decided] } },
      ...facetRows({
        // Rows written before out-of-location requests existed have no kind: corrections.
        fix: [{ $match: { ...created, $or: [{ kind: 'correction' }, { kind: { $exists: false } }] } }, { $group: { _id: '$userId' } }],
        team: [{ $match: created }, team('$managerUserId')],
        decided: deciders,
      }),
    ]),
    branch('reimbursement_claims', [{ $match: { userId: inIds, ...created } }, { $group: { _id: '$userId' } }, tagged('reimb')]),
    // Managers who sent a feedback review in the range (older reviews without sentAt read their last update).
    branch('feedback_records', [
      {
        $match: {
          managerUserId: inIds,
          status: 'sent',
          $or: [{ sentAt: { $gte: start, $lte: end } }, { sentAt: { $exists: false }, updatedAt: { $gte: start, $lte: end } }],
        },
      },
      { $group: { _id: '$managerUserId' } },
      tagged('review'),
    ]),
    // Uploaded an investment proof in the range (a re-upload keeps only its latest time).
    branch('investment_proofs', [{ $match: { org, userId: inIds, uploadedAt: { $gte: start, $lte: end } } }, { $group: { _id: '$userId' } }, tagged('proof')]),
    // An app punch carries the device's location; imported and auto days do not.
    branch('attendance_records', [
      { $match: { userId: inIds, workDate: { $gte: from, $lte: to }, punchInLocation: { $exists: true } } },
      { $group: { _id: '$userId' } },
      tagged('punch'),
    ]),
  ], ONE_BATCH).toArray();

  const managerOf = new Map(roster.map((u) => [u.userId, u.managerUserId ?? '']));
  const by = new Map<string, UsageManager>();
  const add = (managerId: string, r: Answer) => {
    if (!managerId) return;
    const m = by.get(managerId) ?? { id: managerId, got: 0, app: 0, web: 0, wait: 0 };
    m.got += r.got ?? 0;
    m.app += r.app ?? 0;
    m.web += r.web ?? 0;
    m.wait += r.wait ?? 0;
    by.set(managerId, m);
  };
  for (const r of rows) {
    if (r.k === 'leaveTeam') add(managerOf.get(String(r._id)) ?? '', r);
    else if (r.k === 'team' && typeof r._id === 'string') add(r._id, r);
  }
  return {
    sets: setsOf(rows.filter((r) => r.k !== 'leaveTeam' && r.k !== 'team')),
    // Most requests first; a tie in manager id order (it was the order Mongo grouped them in).
    managers: [...by.values()].sort((a, b) => b.got - a.got || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
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

// ── what people did: feed, contests, games, tournaments ───────────────────

const CONTEST_TYPES = ['caption_challenge', 'photo_story_challenge', 'most_likely'];
/** Posts the server writes on its own (celebrations, game and tournament cards). */
const AUTO_TYPES = ['birthday', 'anniversary', 'new_joinee', 'game_launch', 'live_game', 'relay_game', 'secret_squad'];

/** The keys of an object field, as rows `{ k, v }`; nothing for anything else. */
const entriesOf = (field: string) => ({ $cond: [{ $eq: [{ $type: field }, 'object'] }, { $objectToArray: field }, []] });

/**
 * What people did in the range, in one aggregation:
 *   - post: wrote a post themselves (contests count under contests, not here);
 *   - contest: entered, voted or nominated in a contest. An entry (a Most
 *     Likely nomination is one) carries its own time; a vote does not, so
 *     voters count for contests that went out in the range;
 *   - game: played any game. There is no one log of plays: the points ledger
 *     has a row per finished Tile Up, Scribble, Pool and challenge game; a
 *     hosted or catalogue game only shows when it set a new best (its score
 *     row keeps the best alone); a timed launch keeps each player's best in
 *     it; a challenge someone started but has not finished is still a game;
 *   - tour: played in a tournament: joined a Cup match, sat at a Poker table,
 *     showed up for a Hint Relay, or played a Secret Squad round (everyone a
 *     round paid points to).
 */
async function doneIn(org: string, ids: string[], start: Date, end: Date): Promise<Record<string, Set<string>>> {
  const inIds = { $in: ids };
  const range = { $gte: start, $lte: end };
  const own = {
    'author.userId': inIds,
    createdAt: range,
    systemKey: { $exists: false },
    type: { $nin: [...AUTO_TYPES, ...CONTEST_TYPES] },
    'author.designation': { $not: /^Auto/ },
  };
  const entered = { type: { $in: CONTEST_TYPES }, 'captionEntries.createdAt': range };
  const voted = { type: { $in: CONTEST_TYPES }, publishedAt: range, captionVotes: { $exists: true } };
  const people = (field: string, k: string) => [{ $group: { _id: field } }, tagged(k)];
  const rows = await connectPosts().aggregate<Answer>([
    { $match: { org, $or: [own, entered, voted] } },
    // Only what the questions read: a post's comments and media stay on the server.
    {
      $project: {
        _id: 0, type: 1, 'author.userId': 1, 'author.designation': 1, createdAt: 1, systemKey: 1, publishedAt: 1, captionVotes: 1,
        'captionEntries.userId': 1, 'captionEntries.createdAt': 1,
      },
    },
    ...facetRows({
      post: [{ $match: own }, { $group: { _id: '$author.userId' } }],
      contest: [
        { $match: entered },
        { $unwind: '$captionEntries' },
        { $match: { 'captionEntries.createdAt': range, 'captionEntries.userId': inIds } },
        { $group: { _id: '$captionEntries.userId' } },
      ],
      voters: [
        { $match: voted },
        { $project: { v: { $objectToArray: '$captionVotes' } } },
        { $unwind: '$v' },
        { $match: { 'v.k': inIds } },
        { $group: { _id: '$v.k' } },
      ],
    }),
    branch('point_events', [{ $match: { org, userId: inIds, reason: 'game', createdAt: range } }, ...people('$userId', 'game')]),
    branch('game_scores', [{ $match: { org, userId: inIds, achievedAt: range } }, ...people('$userId', 'game')]),
    branch('game_launch_scores', [{ $match: { org, userId: inIds, achievedAt: range } }, ...people('$userId', 'game')]),
    branch('game_challenges', [
      { $match: { org, started: { $exists: true }, createdAt: { $lte: end } } },
      { $project: { s: { $objectToArray: { $ifNull: ['$started', {}] } } } },
      { $unwind: '$s' },
      { $match: { 's.v': range, 's.k': inIds } },
      ...people('$s.k', 'game'),
    ]),
    branch('cup_matches', [
      { $match: { org } },
      { $project: { j: { $objectToArray: { $ifNull: ['$joined', {}] } } } },
      { $unwind: '$j' },
      { $match: { 'j.v': range, 'j.k': inIds } },
      ...people('$j.k', 'tour'),
    ]),
    branch('poker_results', [{ $match: { org, userId: inIds, voided: { $ne: true }, at: range } }, ...people('$userId', 'tour')]),
    // Hint Relay presence has no org: it is the org's events' presence.
    branch('relay_events', [
      { $match: { org } },
      { $project: { _id: 0, id: 1 } },
      {
        $lookup: {
          from: 'relay_presence',
          let: { id: '$id' },
          pipeline: [{ $match: { $expr: { $eq: ['$eventId', '$$id'] }, userId: inIds, lastSeenAt: range } }, { $project: { _id: 0, userId: 1 } }],
          as: 'p',
        },
      },
      { $unwind: '$p' },
      ...people('$p.userId', 'tour'),
    ]),
    branch('secret_squad_payouts', [
      { $match: { org, paidAt: range } },
      { $project: { p: entriesOf('$points') } },
      { $unwind: '$p' },
      { $match: { 'p.k': inIds } },
      ...people('$p.k', 'tour'),
    ]),
  ], ONE_BATCH).toArray();
  const sets = setsOf(rows);
  for (const id of sets.voters ?? []) (sets.contest ??= new Set()).add(id);
  return sets;
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
