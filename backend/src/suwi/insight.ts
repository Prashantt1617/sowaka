/**
 * The checks Suwi runs on one pending request or claim, in plain words, so HR
 * can see at a glance whether it looks fine to approve or deserves a look
 * first. The same checks feed the "safe to approve" list in the Requests
 * review tool and the GET /suwi/insight/:kind/:id box at the top of a drawer.
 *
 * Every check is a fact from the same services the dashboard uses: balances
 * from the leave service, who signs off from the shift policy, caps and
 * backdating windows from Reimbursement types. Nothing here decides anything.
 *
 * Sowaka has no escalation setting: a request a manager leaves alone is never
 * passed to HR by itself; the approver is only reminded on Tuesdays and
 * Thursdays. So "overdue" here means a request that has outlived two of those
 * reminders, OVERDUE_DAYS, and the review tool lets HR pick another number.
 */
import { ObjectId } from 'mongodb';
import { attendanceRegularizations, leaves, overtimeRequests, reimbursementClaims, users } from '../config/db';
import { User } from '../models/user.model';
import { Leave } from '../models/leave.model';
import { OvertimeRequest } from '../models/overtime.model';
import { AttendanceRegularization } from '../models/attendance.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { tabsForRequest } from '../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { approversFor } from '../services/request-notifications.service';
import { approvalRulesFor, hrMayDecide, leaveRulesFor, withPolicyMemo } from '../services/shift.service';
import { getMyLeaveBalance } from '../services/leave.service';
import { typesForOrg } from '../services/reimbursement-type.service';

export const OVERDUE_DAYS = 7;

export type InsightKind = 'leave' | 'overtime' | 'correction' | 'ool' | 'claim';
export const INSIGHT_KINDS: InsightKind[] = ['leave', 'overtime', 'correction', 'ool', 'claim'];
export interface Check { ok: boolean; text: string }
export interface Insight {
  ok: boolean;
  checks: Check[];
  /** Only a pending request gets a verdict; the box hides itself otherwise. */
  pending: boolean;
  /** Who raised it, for a link. */
  userId: string;
  name: string;
}

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const isoDay = (d: Date | number | string | undefined) => (d == null ? '' : new Date(d).toISOString().slice(0, 10));
export const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000));
export const daysWaiting = (createdAt: Date | number | string | undefined, today: string) => daysBetween(isoDay(createdAt) || today, today);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
const span = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} to ${fmt(b)}`);
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** May this dashboard user read what this admin route shows? The same tab rule as the API. */
export function mayRead(user: Pick<User, 'dashboardAdmin' | 'dashboardTabs'>, path: string): boolean {
  if (hasAllDashboardTabs(user)) return true;
  const needed = tabsForRequest('GET', path);
  if (needed === null) return true;
  const mine = new Set(user.dashboardTabs ?? []);
  return needed.some((tab) => mine.has(tab));
}

// —— Shared checks ——

/**
 * How long it has waited, against the overdue limit. Never a reason to hold
 * back (waiting longer is a reason to decide), so it never turns the verdict.
 */
export function waitingCheck(createdAt: Date | number | string | undefined, today: string, limit = OVERDUE_DAYS): Check {
  const waiting = daysWaiting(createdAt, today);
  const since = isoDay(createdAt);
  const how = waiting === 0 ? 'Submitted today' : `Waiting ${plural(waiting, 'day')}${since ? ` (since ${fmt(since)})` : ''}`;
  return { ok: true, text: waiting >= limit ? `${how}: past the ${limit}-day limit, so worth deciding soon.` : `${how}, within the ${limit}-day limit.` };
}

/** HR can't approve their own request: the dashboard refuses it. */
export const ownRequestCheck: Check = { ok: false, text: 'This is your own request: someone else in HR has to decide it.' };

/**
 * Whose call it is. HR's own when there is no manager or the policy names HR;
 * otherwise the manager hasn't acted and an HR decision is an override.
 */
export async function managerStepCheck(employee: User, kind: 'leave' | 'overtime' | 'correction', createdAt: Date | number | string | undefined, today: string): Promise<Check & { managerUserId?: string; managerName?: string }> {
  const approvers = await approversFor(employee, kind);
  const named = employee.managerUserId ? approvers.find((a) => a.userId === employee.managerUserId) : undefined;
  // A manager recorded from another company is never named or reminded from here.
  const manager = named && named.org === employee.org ? named : undefined;
  const label = kind === 'correction' ? 'attendance corrections' : kind;
  if (!manager) {
    return named
      ? { ok: true, text: 'Their reporting manager is not on this company\'s roster, so this is HR\'s call.' }
      : employee.managerUserId
        ? { ok: true, text: `The policy names HR as the approver for ${label}, so this is HR's call.` }
        : { ok: true, text: 'No reporting manager is set, so this is HR\'s call.' };
  }
  const waiting = daysWaiting(createdAt, today);
  const rules = kind === 'overtime' ? { approver: 'Reporting manager', hrOverride: true } : await approvalRulesFor(employee.userId, kind);
  const canOverride = hrMayDecide(rules.approver, rules.hrOverride);
  return {
    ok: false,
    managerUserId: manager.userId, managerName: manager.name,
    text: `${manager.name} is the approver and hasn't acted in ${plural(waiting, 'day')}. ${canOverride ? 'Approving here is an HR override.' : 'HR override is off for this, so only they can decide.'}`,
  };
}

// —— Leave ——

export async function leaveChecks(leave: Leave & { _id?: ObjectId }, employee: User, today: string, limit = OVERDUE_DAYS): Promise<Check[]> {
  const start = isoDay(leave.startDate), end = isoDay(leave.endDate);
  const days = leave.days ?? (leave.halfDay ? 0.5 : daysBetween(start, end) + 1);
  // The three lookups are independent; run them side by side so the drawer box arrives quickly.
  const [balanceCheck, clashCheck, step] = await Promise.all([
    leaveBalanceCheck(leave, employee, start, days),
    teamClashCheck(employee, start, end),
    managerStepCheck(employee, 'leave', leave.createdAt, today),
  ]);
  return [balanceCheck, clashCheck, { ok: step.ok, text: step.text }, waitingCheck(leave.createdAt, today, limit)];
}

/** How many pending leave requests get the full checks (the oldest first). */
export const LEAVE_CHECK_LIMIT = 40;

/**
 * Which pending leave requests are safe to approve: every check passes (balance,
 * no clash in the department, HR's turn to decide) and it isn't the asker's own.
 * The review tool and the "fine to approve" notice both use this, so they agree.
 */
export async function leaveSafety<R extends { id: string; userId: string; daysWaiting: number }>(org: string, viewerUserId: string, today: string, rows: R[], limit = OVERDUE_DAYS) {
  const checkable = rows.filter((r) => ObjectId.isValid(r.id)).sort((a, b) => b.daysWaiting - a.daysWaiting).slice(0, LEAVE_CHECK_LIMIT);
  const safe: (R & { checks: string[] })[] = [];
  const checkFirst: (R & { issues: string[] })[] = [];
  if (!checkable.length) return { checked: 0, safe, checkFirst };
  const [docs, people] = await Promise.all([
    leaves().find({ _id: { $in: checkable.map((r) => new ObjectId(r.id)) } }).toArray(),
    users().find({ org, userId: { $in: checkable.map((r) => r.userId) } }).toArray(),
  ]);
  const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
  const person = new Map(people.map((p) => [p.userId, p]));
  const results = await Promise.all(checkable.map(async (r) => {
    const doc = byId.get(r.id), employee = person.get(r.userId);
    if (!doc || !employee || doc.status !== 'pending') return null;
    return { r, checks: [...(r.userId === viewerUserId ? [ownRequestCheck] : []), ...(await leaveChecks(doc, employee, today, limit))] };
  }));
  for (const x of results) {
    if (!x) continue;
    if (x.checks.every((c) => c.ok)) safe.push({ ...x.r, checks: x.checks.map((c) => c.text) });
    else checkFirst.push({ ...x.r, issues: x.checks.filter((c) => !c.ok).map((c) => c.text) });
  }
  return { checked: checkable.length, safe, checkFirst };
}

/** Balance for the year the leave falls in; approved counts as used, pending shown separately. */
async function leaveBalanceCheck(leave: Leave & { _id?: ObjectId }, employee: User, start: string, days: number): Promise<Check> {
  // The rules and the balance share one lookup of this person's shift policy.
  return withPolicyMemo(() => leaveBalanceCheckIn(leave, employee, start, days));
}

async function leaveBalanceCheckIn(leave: Leave & { _id?: ObjectId }, employee: User, start: string, days: number): Promise<Check> {
  const year = Number(start.slice(0, 4));
  // The balance and the other pending leave are read while the rules are, not
  // after: they are only used when a balance is tracked, which it usually is.
  const reads = Promise.all([
    getMyLeaveBalance(employee.userId, year, new Date(`${start}T00:00:00Z`)),
    leaves().find({ userId: employee.userId, type: leave.type, status: 'pending', ...(leave._id ? { _id: { $ne: leave._id } } : {}), startDate: { $lte: new Date(Date.UTC(year, 11, 31)) }, endDate: { $gte: new Date(Date.UTC(year, 0, 1)) } }).toArray(),
  ]);
  reads.catch(() => undefined); // unused when no balance is tracked; otherwise awaited below
  const rules = await leaveRulesFor(employee.userId);
  if (!rules.balanceTracked) return { ok: true, text: 'No balance is tracked for this team: leave is approved without counting it down.' };
  const [balance, otherPending] = await reads;
  const type = balance.types.find((t) => t.key === leave.type);
  if (!type) return { ok: false, text: `"${leave.type}" is not a leave type on their shift template any more.` };
  const pendingDays = otherPending.reduce((n, l) => n + (l.days ?? 1), 0);
  const period = (type as { cadence?: string }).cadence === 'monthly' ? 'this month' : `in ${year}`;
  const enough = type.remaining >= days;
  return {
    ok: enough,
    text: `${type.name}: ${type.remaining} of ${type.total} left ${period}; this takes ${days}${enough ? '' : ', more than is left'}.${pendingDays ? ` Another ${plural(pendingDays, 'day')} of ${type.name} is pending too.` : ''}`,
  };
}

/** A colleague in the same department (or, without one, under the same manager) off on overlapping dates. */
async function teamClashCheck(employee: User, start: string, end: string): Promise<Check> {
  const scope = employee.department ? { department: employee.department } : employee.managerUserId ? { managerUserId: employee.managerUserId } : null;
  const team = scope ? await users().find({ org: employee.org, ...scope, userId: { $ne: employee.userId }, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1 } }).toArray() : [];
  const teamLabel = employee.department ?? 'the same team';
  if (!team.length) return { ok: true, text: `No one else is in ${teamLabel}, so there is no clash to check.` };
  const overlapping = await leaves().find({ userId: { $in: team.map((p) => p.userId) }, status: { $in: ['approved', 'pending'] }, startDate: { $lte: new Date(`${end}T00:00:00Z`) }, endDate: { $gte: new Date(`${start}T00:00:00Z`) } }).toArray();
  const nameOf = new Map(team.map((p) => [p.userId, p.name]));
  const who = (rows: Leave[]) => rows.slice(0, 3).map((l) => `${nameOf.get(l.userId)} (${span(isoDay(l.startDate), isoDay(l.endDate))})`).join(', ') + (rows.length > 3 ? ` and ${rows.length - 3} more` : '');
  const approved = overlapping.filter((l) => l.status === 'approved');
  const pending = overlapping.filter((l) => l.status === 'pending');
  if (approved.length) return { ok: false, text: `Also off in ${teamLabel} on those dates: ${who(approved)}.${pending.length ? ` Pending as well: ${who(pending)}.` : ''}` };
  return { ok: true, text: `No one else in ${teamLabel} is on approved leave ${span(start, end)}.${pending.length ? ` Pending for the same dates: ${who(pending)}.` : ''}` };
}

// —— Overtime, corrections, out-of-location ——

async function overtimeChecks(ot: OvertimeRequest & { _id: ObjectId }, employee: User, today: string, limit: number): Promise<Check[]> {
  const year = today.slice(0, 4);
  const thisYear = await overtimeRequests().find({ userId: employee.userId, _id: { $ne: ot._id }, workDate: { $gte: new Date(`${year}-01-01T00:00:00Z`), $lte: new Date(`${year}-12-31T00:00:00Z`) } }).toArray();
  const approved = thisYear.filter((r) => r.status === 'approved');
  const hours = Math.round(approved.reduce((n, r) => n + (r.hours ?? 0), 0) * 10) / 10;
  const declined = thisYear.filter((r) => r.status === 'declined').length;
  const pending = thisYear.filter((r) => r.status === 'pending').length;
  const step = await managerStepCheck(employee, 'overtime', ot.createdAt, today);
  return [
    { ok: step.ok, text: step.text },
    waitingCheck(ot.createdAt, today, limit),
    { ok: true, text: thisYear.length ? `This year: ${plural(approved.length, 'other overtime request')} approved (${hours} h)${declined ? `, ${declined} declined` : ''}${pending ? `, ${pending} more pending` : ''}.` : 'Their first overtime request this year.' },
  ];
}

async function regularizationChecks(row: AttendanceRegularization & { _id: ObjectId }, employee: User, today: string, limit: number): Promise<Check[]> {
  const kind = row.kind ?? 'correction';
  const year = today.slice(0, 4);
  const thisYear = await attendanceRegularizations().find({ userId: employee.userId, _id: { $ne: row._id }, workDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` }, ...(kind === 'out_of_location' ? { kind: 'out_of_location' } : { kind: { $ne: 'out_of_location' } }) } as never).toArray();
  const n = (s: string) => thisYear.filter((r) => r.status === s).length;
  const what = kind === 'out_of_location' ? 'out-of-location request' : 'correction';
  const filed = daysBetween(row.workDate, isoDay(row.createdAt) || today);
  const step = await managerStepCheck(employee, 'correction', row.createdAt, today);
  return [
    { ok: step.ok, text: step.text },
    waitingCheck(row.createdAt, today, limit),
    { ok: true, text: `${filed === 0 ? `Filed the same day (${fmt(row.workDate)})` : `Filed ${plural(filed, 'day')} after the day (${fmt(row.workDate)})`}. ${thisYear.length ? `This year: ${plural(n('approved'), `other ${what}`)} approved${n('declined') ? `, ${n('declined')} declined` : ''}${n('pending') ? `, ${n('pending')} more pending` : ''}.` : `Their first ${what} this year.`}` },
  ];
}

// —— Claims ——

async function claimChecks(claim: ReimbursementClaim & { _id: ObjectId }, employee: User, today: string, limit: number): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(claim.receiptObjectKey || claim.receiptName
    ? { ok: true, text: `Bill attached${claim.receiptName ? ` (${claim.receiptName})` : ''}.` }
    : { ok: false, text: 'No bill attached to this claim.' });
  const types = await typesForOrg(employee.org ?? '');
  const type = types.find((t) => t.name.toLowerCase() === claim.category.toLowerCase());
  if (!type) {
    checks.push({ ok: false, text: `"${claim.category}" is not a reimbursement type in Settings any more.` });
  } else {
    if (!type.active) checks.push({ ok: false, text: `${type.name} is switched off in Reimbursement types.` });
    checks.push(type.maxLimit > 0
      ? claim.amount <= type.maxLimit
        ? { ok: true, text: `${rupees(claim.amount)} is within the ${rupees(type.maxLimit)} cap for ${type.name}.` }
        : { ok: false, text: `${rupees(claim.amount)} is over the ${rupees(type.maxLimit)} cap for ${type.name}.` }
      : { ok: true, text: `${rupees(claim.amount)}; ${type.name} has no cap.` });
    const back = daysBetween(isoDay(claim.expenseDate), isoDay(claim.createdAt) || today);
    checks.push(back <= type.backdateDays
      ? { ok: true, text: `Bill dated ${fmt(isoDay(claim.expenseDate))}, filed ${plural(back, 'day')} later; ${type.name} allows ${type.backdateDays}.` }
      : { ok: false, text: `Bill dated ${fmt(isoDay(claim.expenseDate))}, filed ${plural(back, 'day')} later; ${type.name} allows only ${type.backdateDays}.` });
  }
  checks.push(waitingCheck(claim.createdAt, today, limit));
  const year = today.slice(0, 4);
  const thisYear = await reimbursementClaims().find({ userId: employee.userId, _id: { $ne: claim._id }, expenseDate: { $gte: new Date(`${year}-01-01T00:00:00Z`), $lte: new Date(`${year}-12-31T00:00:00Z`) } }).toArray();
  const paid = thisYear.filter((c) => c.status === 'approved' || c.status === 'paid');
  checks.push({ ok: true, text: `This year: ${plural(paid.length, 'other claim')} approved (${rupees(paid.reduce((n, c) => n + c.amount, 0))})${thisYear.filter((c) => c.status === 'pending').length ? `, ${thisYear.filter((c) => c.status === 'pending').length} more pending` : ''}.` });
  return checks;
}

// —— One request by id ——

/** The dashboard route each kind is shown on; its tab rule decides who may ask. */
export const INSIGHT_ROUTE: Record<InsightKind, string> = {
  leave: '/admin/leaves', overtime: '/admin/overtime', correction: '/admin/regularizations', ool: '/admin/out-of-location', claim: '/admin/reimbursements',
};

export async function insightFor(org: string, today: string, kind: InsightKind, idInput: string, viewerUserId?: string, limit = OVERDUE_DAYS): Promise<Insight | null> {
  const id = idInput.replace(/^request:/, '');
  if (!ObjectId.isValid(id)) return null;
  const _id = new ObjectId(id);
  const inOrg = async (userId: string) => users().findOne({ userId, org });
  const verdict = (employee: User, status: string, found: Check[]): Insight => {
    const checks = status === 'pending' && viewerUserId === employee.userId ? [ownRequestCheck, ...found] : found;
    return { ok: checks.every((c) => c.ok), checks, pending: status === 'pending', userId: employee.userId, name: employee.name };
  };
  if (kind === 'leave') {
    const leave = await leaves().findOne({ _id });
    const employee = leave && (await inOrg(leave.userId));
    if (!leave || !employee) return null;
    return verdict(employee, leave.status, leave.status === 'pending' ? await leaveChecks(leave, employee, today, limit) : []);
  }
  if (kind === 'overtime') {
    const ot = await overtimeRequests().findOne({ _id });
    const employee = ot && (await inOrg(ot.userId));
    if (!ot || !employee) return null;
    return verdict(employee, ot.status, ot.status === 'pending' ? await overtimeChecks(ot, employee, today, limit) : []);
  }
  if (kind === 'correction' || kind === 'ool') {
    const row = await attendanceRegularizations().findOne({ _id });
    const employee = row && (await inOrg(row.userId));
    if (!row || !employee) return null;
    return verdict(employee, row.status, row.status === 'pending' ? await regularizationChecks(row, employee, today, limit) : []);
  }
  const claim = await reimbursementClaims().findOne({ _id });
  const employee = claim && (await inOrg(claim.userId));
  if (!claim || !employee) return null;
  return verdict(employee, claim.status, claim.status === 'pending' ? await claimChecks(claim, employee, today, limit) : []);
}
