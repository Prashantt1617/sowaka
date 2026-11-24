/**
 * Managers on the HR dashboard (24 Nov 2026, HR: "now we are allowing managers to access the dashboard").
 *
 * In a company with `features.managerDashboard` on, anyone with at least one active direct report may sign
 * in to the dashboard without HR giving them access. They get the manager's tabs only (Time Office, People
 * without salary details or exits, Employee lifecycle, Performance: no Setup, Payroll, Tax, Claims,
 * Engagement or Suwi), and every list and action is limited to their team: the whole subtree below them,
 * with them as its root. HR's own access (dashboardAccess given in People › Accesses) is unchanged.
 *
 * Someone HR gave dashboard access to keeps it; `dashboardScope: 'team'` on a user limits even a given
 * access to their team (for HR to use in Accesses later).
 */
import { companies, users } from '../config/db';
import type { User } from '../models/user.model';
import { requestUserFor } from './request-user';

/** The tabs a manager gets (the server's tab keys; the sidebar shows their sections). */
export const MANAGER_TABS = [
  // Time Office
  'leave', 'overtime', 'attendance', 'oolcheckins', 'attendancereport',
  // People (no salary details, no exits, no Accesses, no Tasks)
  'employees', 'orgchart',
  // Not the Employee lifecycle (24 Nov 2026, HR: "hide employee lifecycle as well").
  // Performance: reviews, and assigning KPI templates HR set up (not the parameters, templates or cycle setup)
  'feedback', 'kpibulk',
] as const;

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const TTL_MS = 60_000;

type Tree = { at: number; reports: Map<string, string[]> };
const trees = new Map<string, Tree>();
const featureOn = new Map<string, { at: number; on: boolean }>();

/** Who reports to whom in a company (active people), kept a minute. */
async function treeOf(org: string): Promise<Map<string, string[]>> {
  const kept = trees.get(org);
  if (kept && Date.now() - kept.at < TTL_MS) return kept.reports;
  const rows = await users().find({ org, ...ACTIVE, managerUserId: { $exists: true, $ne: '' } } as never, { projection: { _id: 0, userId: 1, managerUserId: 1 } }).toArray();
  const reports = new Map<string, string[]>();
  for (const r of rows) {
    const m = (r as { managerUserId?: string }).managerUserId;
    if (!m || m === r.userId) continue;
    (reports.get(m) ?? reports.set(m, []).get(m)!).push(r.userId);
  }
  trees.set(org, { at: Date.now(), reports });
  return reports;
}

/** Drop the kept tree (a reporting change). */
export function forgetTeams(org?: string): void {
  if (org) trees.delete(org); else trees.clear();
}

/** Everyone in `rootId`'s subtree, them included. A loop in the data ends the walk. */
export async function subtreeOf(org: string, rootId: string): Promise<Set<string>> {
  const reports = await treeOf(org);
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const r of reports.get(queue.shift()!) ?? []) if (!out.has(r)) { out.add(r); queue.push(r); }
  }
  return out;
}

/** `rootId`'s direct reports (active). */
export async function directReportsOf(org: string, rootId: string): Promise<string[]> {
  return [...((await treeOf(org)).get(rootId) ?? [])];
}

async function managerDashboardOn(org: string): Promise<boolean> {
  const kept = featureOn.get(org);
  if (kept && Date.now() - kept.at < TTL_MS) return kept.on;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  const on = (company?.features as { managerDashboard?: boolean } | undefined)?.managerDashboard === true;
  featureOn.set(org, { at: Date.now(), on });
  return on;
}

export type DashboardGrant = { access: boolean; tabs: string[] | null; teamScope: boolean };

/**
 * What the dashboard lets this person do: HR's grant as it is; otherwise, in a company with the manager
 * dashboard on, a manager's (their tabs, their team). Nobody else.
 */
export async function dashboardGrantOf(user: Pick<User, 'userId' | 'org' | 'dashboardAccess' | 'dashboardAdmin' | 'dashboardTabs'> & { dashboardScope?: string }): Promise<DashboardGrant> {
  if (user.dashboardAccess === true) {
    const team = user.dashboardAdmin !== true && user.dashboardScope === 'team';
    return { access: true, tabs: user.dashboardAdmin === true || !Array.isArray(user.dashboardTabs) ? null : user.dashboardTabs, teamScope: team };
  }
  if (!user.org || !(await managerDashboardOn(user.org))) return { access: false, tabs: null, teamScope: false };
  const reports = (await treeOf(user.org)).get(user.userId) ?? [];
  if (!reports.length) return { access: false, tabs: null, teamScope: false };
  return { access: true, tabs: [...MANAGER_TABS], teamScope: true };
}

/**
 * The people a dashboard caller may see: null for the whole company (HR), else their subtree. Reads the
 * request's signed-in caller (no lookup) when it is them.
 */
export async function scopedUserIds(callerId: string): Promise<Set<string> | null> {
  const caller = requestUserFor(callerId);
  if (caller) return caller.teamScope && caller.org ? subtreeOf(caller.org, callerId) : null;
  const u = await users().findOne({ userId: callerId }, { projection: { _id: 0, userId: 1, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1, dashboardScope: 1 } }) as (User & { dashboardScope?: string }) | null;
  if (!u?.org) return null;
  const grant = await dashboardGrantOf(u);
  return grant.teamScope ? subtreeOf(u.org, callerId) : null;
}

export class OutOfTeamError extends Error {
  statusCode = 403;
  constructor(message = 'That person is not in your team') { super(message); this.name = 'OutOfTeamError'; }
}

/** Refuses when a team-scoped caller acts on someone outside their subtree. HR passes. */
export async function assertInTeam(callerId: string, userId: string | undefined | null): Promise<void> {
  const ids = await scopedUserIds(callerId);
  if (ids && (!userId || !ids.has(userId))) throw new OutOfTeamError();
}
