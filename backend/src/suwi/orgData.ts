/**
 * What Suwi reads for a whole company, once, and shares between everyone who
 * looks: the waiting requests (leave, overtime, corrections, check-ins,
 * claims), the leave safety checks, the pending claims and their types'
 * caps, People › Tasks, and the engagement counts.
 *
 * These are company-wide lists (the dashboard's Requests pages show every
 * request in the org to whoever may open them), so one copy serves every
 * viewer: each viewer then keeps only what their tabs allow (`forViewer`),
 * in microseconds. Before, every HR user and manager had their own copy, and
 * the first look of each cost the whole read (about 6.5 s on the throttled
 * database link); a Suwi question re-read the waiting pile again (about 2 s).
 *
 * Kept in swr-cache (kind `suwi-org-data`, lifecycle/readCache): served at
 * once and refreshed behind the reader after a minute, warmed per company in
 * the engagement round, and dropped by the write hook on every API write that
 * can change it (a leave or claim decided, a request made), so a decided
 * request leaves the counts at once. Today's attendance is not kept here: it
 * comes from the attendance report's own short-lived copy at view time.
 */
import { connectPosts, relayEvents, reimbursementTypes, users } from '../config/db';
import { cachedLifecycle, refreshLifecycle } from '../services/lifecycle/readCache';
import { listAllReimbursementsForAdmin } from '../services/reimbursement.service';
import { peopleTasks } from '../services/peopleTasks.service';
import { leaveSafety, INSIGHT_ROUTE, mayRead } from './insight';
import { pendingRows, PendingRow, sharedAdminLists } from './tools/requests';

const DAY = 86_400_000;

type Claim = { id: string; userId: string; status: string; hasReceipt: boolean; amount: number; category: string };
type Safety = Awaited<ReturnType<typeof leaveSafety<PendingRow>>>;

export interface OrgSuwiData {
  /** Every pending request in the org, of every type. */
  pending: PendingRow[] | null;
  /** The leave safety checks over the pending leave, with no viewer (a viewer's own request is taken out per viewer). */
  leaveSafe: Pick<Safety, 'safe' | 'checkFirst'> | null;
  claims: Claim[] | null;
  claimTypes: { name: string; maxLimit: number }[] | null;
  /** People › Tasks as the reader saw it: who is missing what. `payroll` says whether salary and bank were checked. */
  tasks: { payroll: boolean; people: { userId: string; keys: string[] }[] } | null;
  relayScheduled: number | null;
  engagementPostsRecent: number | null;
  /** Who the lists were read as (a dashboard admin of the company), for the record. */
  readerUserId: string;
  at: string;
}

async function quietly<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch { return null; }
}

/**
 * The person the company's lists are read as: a dashboard admin (who may see every list and has
 * payroll access, so People › Tasks checks salary and bank), never a hidden support account.
 * Falls back to the person asking.
 */
export async function readerFor(org: string, fallbackUserId: string): Promise<{ userId: string }> {
  const active = { org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true } };
  // A dashboard admin first; else someone with every tab (no tab list), who sees the same lists.
  const admin = await users().findOne({ ...active, dashboardAdmin: true }, { projection: { _id: 0, userId: 1 } })
    ?? await users().findOne({ ...active, dashboardTabs: { $exists: false } }, { projection: { _id: 0, userId: 1 } });
  return { userId: admin?.userId ?? fallbackUserId };
}

export async function loadOrgSuwiData(org: string, today: string, fallbackUserId: string): Promise<OrgSuwiData> {
  const reader = await readerFor(org, fallbackUserId);
  const ctx = { userId: reader.userId, today, user: { dashboardAdmin: true } };
  // The leave and the claims lists are each wanted twice (the pile, and the safety checks or the
  // claims notice): each is read once and shared.
  const lists = sharedAdminLists();
  const pendingP = quietly(() => pendingRows(ctx, '', lists));
  const [pending, claims, claimTypes, tasks, relayScheduled, engagementPostsRecent] = await Promise.all([
    pendingP,
    quietly(() => lists.claims(reader.userId)),
    quietly(() => reimbursementTypes().find({ org }).project<{ name: string; maxLimit: number }>({ _id: 0, name: 1, maxLimit: 1 }).toArray()),
    quietly(() => peopleTasks(reader.userId)),
    quietly(() => relayEvents().countDocuments({ org, status: { $in: ['scheduled', 'live'] } })),
    quietly(() => connectPosts().countDocuments({ org, systemKey: { $exists: false }, type: { $in: ['relay_game', 'live_game', 'survey', 'event', 'caption_challenge'] }, publishedAt: { $gte: new Date(Date.now() - 14 * DAY) } })),
  ]);
  const leaveRows = (pending ?? []).filter((r) => r.type === 'leave');
  // No viewer: nobody's request is "their own" here; `forViewer` takes the viewer's own out.
  const safety = pending ? await quietly(() => leaveSafety(org, '', today, leaveRows)) : null;
  return {
    pending,
    leaveSafe: safety ? { safe: safety.safe, checkFirst: safety.checkFirst } : null,
    claims: (claims as Awaited<ReturnType<typeof listAllReimbursementsForAdmin>> | null)?.filter((c) => c.status === 'pending')
      .map((c) => ({ id: c.id, userId: c.userId, status: c.status, hasReceipt: Boolean(c.hasReceipt), amount: c.amount, category: String(c.category) })) ?? null,
    claimTypes,
    tasks: tasks ? { payroll: Boolean(tasks.payroll), people: tasks.people.map((p) => ({ userId: p.userId, keys: p.tasks.map((t) => t.key) })) } : null,
    relayScheduled,
    engagementPostsRecent,
    readerUserId: reader.userId,
    at: new Date().toISOString(),
  };
}

/** The company's shared Suwi inputs, from memory when kept; `fresh` reads them now and keeps them (the warm-up's way in). */
export function orgSuwiData(org: string, today: string, askerUserId: string, fresh = false): Promise<OrgSuwiData> {
  const load = () => loadOrgSuwiData(org, today, askerUserId);
  return fresh ? refreshLifecycle(org, 'suwi-org-data', { today }, load) : cachedLifecycle(org, 'suwi-org-data', { today }, load);
}

const ROUTE_OF: Record<PendingRow['type'], string> = {
  leave: INSIGHT_ROUTE.leave, overtime: INSIGHT_ROUTE.overtime, correction: INSIGHT_ROUTE.correction, checkin: INSIGHT_ROUTE.ool, claim: INSIGHT_ROUTE.claim,
};

/** The waiting requests this viewer may see: the same tab rules as the Requests pages. */
export function pendingFor(user: { dashboardAdmin?: boolean; dashboardTabs?: string[] }, rows: PendingRow[]): PendingRow[] {
  const may = new Map(Object.entries(ROUTE_OF).map(([t, route]) => [t, mayRead(user, route)]));
  return rows.filter((r) => may.get(r.type));
}
