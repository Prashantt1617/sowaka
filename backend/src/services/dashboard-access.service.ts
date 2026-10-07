/**
 * People › Accesses: who can use the HR dashboard, and which tabs each person
 * sees. Only a dashboard admin manages this. An admin sees every tab; anyone
 * else sees the tabs listed for them (no list means every tab, as before).
 */
import { users } from '../config/db';
import { DASHBOARD_TABS } from '../models/dashboard-tabs';

export class DashboardAccessError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'DashboardAccessError';
  }
}

async function orgOf(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } });
  if (!admin?.org) throw new DashboardAccessError(403, 'No organisation on this account');
  return admin.org;
}

function view(u: { userId: string; name: string; email: string; employeeId?: string; designation?: string; department?: string; dashboardAccess?: boolean; dashboardAdmin?: boolean; dashboardTabs?: string[]; lifecycleStatus?: string }) {
  return {
    userId: u.userId,
    name: u.name,
    email: u.email,
    employeeId: u.employeeId,
    designation: u.designation,
    department: u.department,
    admin: u.dashboardAdmin === true,
    // null: every tab.
    tabs: u.dashboardAdmin === true || !Array.isArray(u.dashboardTabs) ? null : u.dashboardTabs,
    active: u.lifecycleStatus !== 'offboarded' && u.lifecycleStatus !== 'terminated',
  };
}

const PROJECTION = { _id: 0, userId: 1, name: 1, email: 1, employeeId: 1, designation: 1, department: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1, lifecycleStatus: 1 } as const;

export async function listDashboardAccesses(adminUserId: string) {
  const org = await orgOf(adminUserId);
  const rows = await users().find({ org, dashboardAccess: true }, { projection: PROJECTION }).sort({ name: 1 }).toArray();
  return { users: rows.map(view), tabs: DASHBOARD_TABS };
}

/**
 * Give, change or take away one person's dashboard access. `access: false`
 * removes it. `admin: true` makes them an admin (every tab). Otherwise `tabs`
 * is the list they get; `null` means every tab.
 */
export async function setDashboardAccess(
  adminUserId: string,
  userId: string,
  input: { access?: unknown; admin?: unknown; tabs?: unknown },
) {
  const org = await orgOf(adminUserId);
  const person = await users().findOne({ userId, org }, { projection: PROJECTION });
  if (!person) throw new DashboardAccessError(404, 'Employee not found in this organisation');

  const access = input.access === undefined ? true : Boolean(input.access);
  const admin = input.admin === undefined ? person.dashboardAdmin === true : Boolean(input.admin);
  let tabs: string[] | null | undefined;
  if (input.tabs === null) tabs = null;
  else if (input.tabs !== undefined) {
    if (!Array.isArray(input.tabs)) throw new DashboardAccessError(400, 'tabs must be a list of tab keys, or null for every tab');
    const known = new Set<string>(DASHBOARD_TABS);
    const unknown = input.tabs.filter((t) => !known.has(String(t)));
    if (unknown.length) throw new DashboardAccessError(400, `Unknown tab: ${unknown.join(', ')}`);
    tabs = [...new Set(input.tabs.map(String))];
    if (!admin && access && tabs.length === 0) throw new DashboardAccessError(400, 'Give at least one tab, or remove their access');
  }

  // The last admin can't remove their own way back in.
  if ((!access || !admin) && person.dashboardAdmin === true) {
    const otherAdmins = await users().countDocuments({ org, dashboardAccess: true, dashboardAdmin: true, userId: { $ne: userId } });
    if (otherAdmins === 0) throw new DashboardAccessError(409, 'Keep at least one admin: make someone else an admin first');
  }

  if (!access) {
    await users().updateOne({ userId, org }, { $set: { dashboardAccess: false, dashboardAdmin: false }, $unset: { dashboardTabs: '' } });
  } else {
    const set: Record<string, unknown> = { dashboardAccess: true, dashboardAdmin: admin };
    const update: Record<string, unknown> = { $set: set };
    if (admin || tabs === null) update.$unset = { dashboardTabs: '' };
    else if (tabs !== undefined) set.dashboardTabs = tabs;
    await users().updateOne({ userId, org }, update);
  }
  const fresh = await users().findOne({ userId, org }, { projection: PROJECTION });
  return { user: fresh && fresh.dashboardAccess ? view(fresh) : null };
}
