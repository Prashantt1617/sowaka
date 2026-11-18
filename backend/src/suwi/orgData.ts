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
import { cachedLifecycle, lifecycleReadCacheOn, refreshLifecycle, setSuwiOrgDataPatch } from '../services/lifecycle/readCache';
import { keptOfKind, peekSwr, pendingSwr } from '../services/swr-cache';
import { listAllReimbursementsForAdmin } from '../services/reimbursement.service';
import { peopleTasks } from '../services/peopleTasks.service';
import { withPolicyMemo } from '../services/shift.service';
import { leaveSafety, managerStepCheck, INSIGHT_ROUTE, mayRead } from './insight';
import { keptGet, keptSet, suwiVersion } from './kept';
import { LIGHT_USER } from './toolCache';
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
  /**
   * Whose call each waiting request is (`<type>:<id>`): the manager who still has to act, or none
   * (HR's turn). Worked out once per company, so review_requests needs no reads of its own.
   */
  approvers?: Record<string, { managerUserId?: string; managerName?: string }>;
  /** People › Tasks whole, as the reader saw it (missing_details answers from it; salary and bank are taken out for a viewer without payroll). */
  tasksFull?: Awaited<ReturnType<typeof peopleTasks>> | null;
  /** The pending claims whole (claims_to_check runs its checks over them with no read of its own). */
  claimsPendingFull?: Awaited<ReturnType<typeof listAllReimbursementsForAdmin>> | null;
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
  const active = { org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] as ('offboarded' | 'terminated')[] }, hiddenFromDirectory: { $ne: true } };
  // A dashboard admin first; else someone with every tab (no tab list), who sees the same lists.
  const admin = await users().findOne({ ...active, dashboardAdmin: true }, { projection: { _id: 0, userId: 1 } })
    ?? await users().findOne({ ...active, dashboardTabs: { $exists: false } }, { projection: { _id: 0, userId: 1 } });
  return { userId: admin?.userId ?? fallbackUserId };
}

/** The bundle's parts a request (leave, overtime, correction, check-in, claim) made, decided or cancelled can change. */
type RequestSections = Pick<OrgSuwiData, 'pending' | 'leaveSafe' | 'claims' | 'approvers' | 'claimsPendingFull'>;

/**
 * The waiting requests and what hangs off them, read as `readerUserId`: pending rows only (each list
 * filters on status in the query), the approver of each, the leave checks and the pending claims.
 * The whole read and the patch after a request write both come through here, so they always agree.
 */
function requestSections(org: string, today: string, readerUserId: string): Promise<RequestSections> {
  // One policy scope for the lot: each person's shift policy, and the company's policy and templates,
  // are looked up once however many requests and checks ask (shift.service withPolicyMemo).
  return withPolicyMemo(() => readRequestSections(org, today, readerUserId));
}

async function readRequestSections(org: string, today: string, readerUserId: string): Promise<RequestSections> {
  const ctx = { userId: readerUserId, today, user: { dashboardAdmin: true } };
  // The leave and the claims lists are each wanted twice (the pile, and the safety checks or the
  // claims notice): each is read once and shared.
  const lists = sharedAdminLists();
  const [pending, claims] = await Promise.all([
    quietly(() => pendingRows(ctx, '', lists)),
    quietly(() => lists.claims(readerUserId)),
  ]);
  const leaveRows = (pending ?? []).filter((r) => r.type === 'leave');
  // No viewer: nobody's request is "their own" here; `forViewer` takes the viewer's own out.
  const [approvers, safety] = pending
    ? await Promise.all([quietly(() => approversOf(org, today, pending)), quietly(() => leaveSafety(org, '', today, leaveRows))])
    : [null, null];
  const pendingClaims = (claims as Awaited<ReturnType<typeof listAllReimbursementsForAdmin>> | null)?.filter((c) => c.status === 'pending') ?? null;
  return {
    pending,
    leaveSafe: safety ? { safe: safety.safe, checkFirst: safety.checkFirst } : null,
    claims: pendingClaims?.map((c) => ({ id: c.id, userId: c.userId, status: c.status, hasReceipt: Boolean(c.hasReceipt), amount: c.amount, category: String(c.category) })) ?? null,
    ...(approvers ? { approvers } : {}),
    claimsPendingFull: pendingClaims,
  };
}

export async function loadOrgSuwiData(org: string, today: string, fallbackUserId: string): Promise<OrgSuwiData> {
  const reader = await readerFor(org, fallbackUserId);
  const [requests, claimTypes, tasks, relayScheduled, engagementPostsRecent] = await Promise.all([
    requestSections(org, today, reader.userId),
    quietly(() => reimbursementTypes().find({ org }).project<{ name: string; maxLimit: number }>({ _id: 0, name: 1, maxLimit: 1 }).toArray()),
    quietly(() => peopleTasks(reader.userId)),
    quietly(() => relayEvents().countDocuments({ org, status: { $in: ['scheduled', 'live'] } })),
    quietly(() => connectPosts().countDocuments({ org, systemKey: { $exists: false }, type: { $in: ['relay_game', 'live_game', 'survey', 'event', 'caption_challenge'] }, publishedAt: { $gte: new Date(Date.now() - 14 * DAY) } })),
  ]);
  return {
    pending: requests.pending,
    leaveSafe: requests.leaveSafe,
    claims: requests.claims,
    claimTypes,
    tasks: tasks ? { payroll: Boolean(tasks.payroll), people: tasks.people.map((p) => ({ userId: p.userId, keys: p.tasks.map((t) => t.key) })) } : null,
    relayScheduled,
    engagementPostsRecent,
    ...(requests.approvers ? { approvers: requests.approvers } : {}),
    tasksFull: tasks,
    claimsPendingFull: requests.claimsPendingFull,
    readerUserId: reader.userId,
    at: new Date().toISOString(),
  };
}

/**
 * The bundle after a request write, from the one kept before it: the waiting-request sections read
 * again (pending rows only, a few KB), everything else carried over (no request write changes People ›
 * Tasks, the claim types or the engagement counts). A bundle with no waiting pile (its read failed) is
 * read whole instead.
 */
export async function patchOrgSuwiData(org: string, today: string, prev: OrgSuwiData): Promise<OrgSuwiData> {
  if (!prev.pending || !prev.readerUserId) return loadOrgSuwiData(org, today, prev.readerUserId ?? '');
  const requests = await requestSections(org, today, prev.readerUserId);
  const { approvers: _oldApprovers, ...rest } = prev;
  void _oldApprovers;
  return {
    ...rest,
    pending: requests.pending,
    leaveSafe: requests.leaveSafe,
    claims: requests.claims,
    ...(requests.approvers ? { approvers: requests.approvers } : {}),
    claimsPendingFull: requests.claimsPendingFull,
    at: new Date().toISOString(),
  };
}

/** When each company's bundle was last patched: the debounced rebuild after the write leaves a fresh patch alone. */
const patchedAt = new Map<string, number>();
const PATCH_KEEPS_MS = 30_000;
export const patchedRecently = (org: string): boolean => Date.now() - (patchedAt.get(org) ?? 0) < PATCH_KEEPS_MS;

/**
 * The write hook's patch (readCache.setSuwiOrgDataPatch): takes the kept bundle before the drop and,
 * once dropped, starts the patch as the bundle's refresh, so a reader arriving meanwhile waits for it
 * (a fraction of a second) rather than reading the whole company. It waits for the data version's bump,
 * then keeps the result in Redis under the new version. Nothing kept: nothing to patch (the debounced
 * rebuild reads it whole).
 */
setSuwiOrgDataPatch((org, bumped) => {
  const kept = keptOfKind<OrgSuwiData>(org, 'suwi-org-data');
  if (!kept.length) return null;
  return () => {
    for (const { params, value } of kept) {
      const today = (params as { today?: string } | null)?.today;
      if (!today) continue;
      refreshLifecycle(org, 'suwi-org-data', { today }, async () => {
        await bumped.catch(() => undefined);
        const data = await patchOrgSuwiData(org, today, value);
        patchedAt.set(org, Date.now());
        const v = await suwiVersion(org);
        if (v) await keptSet(`org:${org}:${today}:${v}`, data, 15 * 60);
        return data;
      }).catch(() => undefined);
    }
  };
});

const STEP_KIND = { leave: 'leave', overtime: 'overtime', correction: 'correction', checkin: 'correction' } as const;

/** Each waiting request's approver: the manager who still has to act, else HR (no entry). */
async function approversOf(org: string, today: string, rows: PendingRow[]): Promise<Record<string, { managerUserId?: string; managerName?: string }>> {
  // Not their photos, face data or documents: no step check reads them.
  const people = await users().find({ org, userId: { $in: [...new Set(rows.map((r) => r.userId))] } }, { projection: LIGHT_USER }).toArray();
  const byId = new Map(people.map((p) => [p.userId, p]));
  const seen = new Map<string, Promise<{ managerUserId?: string; managerName?: string }>>();
  const out: Record<string, { managerUserId?: string; managerName?: string }> = {};
  await Promise.all(rows.map(async (r) => {
    const employee = byId.get(r.userId);
    if (r.type === 'claim' || !employee) return;
    const key = `${r.userId}|${STEP_KIND[r.type]}|${r.submitted}`;
    if (!seen.has(key)) seen.set(key, managerStepCheck(employee, STEP_KIND[r.type], r.submitted, today));
    const step = await seen.get(key)!;
    if (step.managerUserId) out[`${r.type}:${r.id}`] = { managerUserId: step.managerUserId, managerName: step.managerName };
  }));
  return out;
}

/**
 * The bundle from Redis (suwi/kept.ts) when this company's data version has one, so a restart starts
 * warm and every server shares one read; else read now and kept there for 15 minutes.
 */
async function loadThroughRedis(org: string, today: string, askerUserId: string): Promise<OrgSuwiData> {
  const version = await suwiVersion(org);
  const key = version ? `org:${org}:${today}:${version}` : '';
  if (key) {
    const kept = await keptGet<OrgSuwiData>(key);
    if (kept) return kept;
  }
  const data = await loadOrgSuwiData(org, today, askerUserId);
  if (key) await keptSet(key, data, 15 * 60);
  return data;
}

/** The company's shared Suwi inputs, from memory when kept (then Redis); `fresh` reads them now and keeps them (the warm-up's way in). */
export function orgSuwiData(org: string, today: string, askerUserId: string, fresh = false): Promise<OrgSuwiData> {
  const load = () => (fresh ? loadOrgSuwiData(org, today, askerUserId).then(async (d) => { const v = await suwiVersion(org); if (v) await keptSet(`org:${org}:${today}:${v}`, d, 15 * 60); return d; }) : loadThroughRedis(org, today, askerUserId));
  return fresh ? refreshLifecycle(org, 'suwi-org-data', { today }, load) : cachedLifecycle(org, 'suwi-org-data', { today }, load);
}

/**
 * The kept copy if there is one; otherwise null, and a refresh starts behind the caller. For a
 * reader that can make do with a narrower read of its own (pending_requests), so a question right
 * after a write never waits on the whole company bundle.
 */
export function keptOrgSuwiData(org: string, today: string, askerUserId: string): OrgSuwiData | null {
  if (!lifecycleReadCacheOn()) return null;
  const kept = peekSwr<OrgSuwiData>(org, 'suwi-org-data', { today });
  if (kept) return kept;
  orgSuwiData(org, today, askerUserId, true).catch(() => undefined);
  return null;
}

/**
 * The kept bundle from memory, then Redis (the data version's copy), without reading the database:
 * null when neither has one, and a refresh starts behind the caller.
 */
export async function keptOrgSuwiDataAsync(org: string, today: string, askerUserId: string): Promise<OrgSuwiData | null> {
  if (!lifecycleReadCacheOn()) return null;
  const inMemory = peekSwr<OrgSuwiData>(org, 'suwi-org-data', { today });
  if (inMemory) return inMemory;
  // A patch after a request write (or a rebuild) under way: wait for it, it is the quickest way to an
  // answer that includes the change (reading for ourselves would repeat the same read, or more).
  const inFlight = pendingSwr<OrgSuwiData>(org, 'suwi-org-data', { today });
  if (inFlight) return inFlight.catch(() => null);
  const version = await suwiVersion(org);
  const fromRedis = version ? await keptGet<OrgSuwiData>(`org:${org}:${today}:${version}`) : null;
  // Through orgSuwiData either way, so memory holds it next time (Redis answers the load at once when it has it).
  orgSuwiData(org, today, askerUserId).catch(() => undefined);
  return fromRedis;
}

const ROUTE_OF: Record<PendingRow['type'], string> = {
  leave: INSIGHT_ROUTE.leave, overtime: INSIGHT_ROUTE.overtime, correction: INSIGHT_ROUTE.correction, checkin: INSIGHT_ROUTE.ool, claim: INSIGHT_ROUTE.claim,
};

/** The waiting requests this viewer may see: the same tab rules as the Requests pages. */
export function pendingFor(user: { dashboardAdmin?: boolean; dashboardTabs?: string[] }, rows: PendingRow[]): PendingRow[] {
  const may = new Map(Object.entries(ROUTE_OF).map(([t, route]) => [t, mayRead(user, route)]));
  return rows.filter((r) => may.get(r.type));
}

/** People › Tasks as this viewer sees it, from the kept copy: salary and bank tasks only with payroll access (as peopleTasks itself does). Null when the copy can't stand in. */
export function tasksForViewer(full: OrgSuwiData['tasksFull'], payroll: boolean): Awaited<ReturnType<typeof peopleTasks>> | null {
  if (!full) return null;
  // A copy read without payroll can't answer a viewer who has it (the salary and bank tasks were never worked out).
  if (payroll && !full.payroll) return null;
  if (payroll) return full;
  const people = full.people.map((p) => ({ ...p, tasks: p.tasks.filter((t) => t.key !== 'salary' && t.key !== 'bank') })).filter((p) => p.tasks.length);
  return { ...full, payroll: false, people };
}
