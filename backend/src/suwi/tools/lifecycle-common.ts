// Shared by Suwi's employee-lifecycle tools (offers, pre-boarding, probation, offboarding, templates):
// the features.lifecycle switch answered plainly, the HR actor the lifecycle services expect, and
// finding a joiner (a candidate is not a user until Mark joined) by name or id.
import { journeys, users } from '../../config/db';
import type { Journey } from '../../models/lifecycle.model';
import { lifecycleViewer } from '../../services/lifecycle/board';
import { lifecycleEnabled } from '../../services/lifecycle/emails';
import type { HrActor } from '../../services/lifecycle/offers';
import { str, SuwiContext, ToolOutput } from '../tools';
import { norm } from './people';

/** Null when the company has the lifecycle on; otherwise the plain answer the tool returns. */
export async function lifecycleOff(ctx: SuwiContext): Promise<ToolOutput | null> {
  if (await lifecycleEnabled(ctx.org)) return null;
  return {
    data: {
      available: false,
      message: 'Employee lifecycle (offers, pre-boarding, probation, offboarding and their templates) is not switched on for this company, so there is nothing to show or change here. Exits are on People › Exits instead.',
    },
  };
}

/** The dashboard user as the lifecycle services take them; `seesPay` is the dashboard's one "may see pay" rule. */
export const hrActorOf = (ctx: SuwiContext): HrActor => ({ userId: ctx.userId, name: ctx.user.name, org: ctx.org, seesPay: lifecycleViewer(ctx.user).seesPay });
export const seesDocumentsOf = (ctx: SuwiContext) => lifecycleViewer(ctx.user).seesDocuments;

export type JoinerRow = Pick<Journey, 'id' | 'userId' | 'candidate' | 'status' | 'tj' | 'designation' | 'department' | 'managerUserId' | 'employeeId' | 'probation'> & { name: string };

/** Every open onboarding journey of the company, with the joiner's name (the account's once joined). */
export async function openJoiners(ctx: SuwiContext): Promise<JoinerRow[]> {
  const rows = await journeys().find(
    { org: ctx.org, kind: 'onboarding', closedAt: { $exists: false } },
    { projection: { _id: 0, id: 1, userId: 1, candidate: 1, status: 1, tj: 1, designation: 1, department: 1, managerUserId: 1, employeeId: 1, probation: 1 } },
  ).toArray();
  const ids = rows.map((j) => j.userId).filter((x): x is string => !!x);
  const names = new Map((ids.length ? await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray() : []).map((u) => [u.userId, u.name]));
  return rows.map((j) => ({ ...(j as unknown as JoinerRow), name: (j.userId ? names.get(j.userId) : undefined) ?? j.candidate?.name ?? '—' }));
}

/** One joiner by journey id, userId or name. A first name is enough when only one joiner has it. */
export function pickJoiner(rows: JoinerRow[], ref: unknown, what = 'joiner'): JoinerRow {
  const r = str(ref, 120);
  if (!r) throw new Error(`Say which ${what}: a name or id`);
  const exact = rows.find((j) => j.id === r || j.userId === r || (j.candidate?.personalEmail ?? '').toLowerCase() === r.toLowerCase());
  if (exact) return exact;
  const n = norm(r);
  const full = rows.filter((j) => norm(j.name) === n);
  if (full.length === 1) return full[0];
  const partial = full.length ? full : rows.filter((j) => norm(j.name).split(' ').includes(n) || norm(j.name).includes(n));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`No open ${what} called "${r}" (offers, pre-boarding, first week and probation are searched)`);
  throw new Error(`More than one ${what} matches "${r}": ${partial.slice(0, 6).map((j) => `${j.name}${j.designation ? ` (${j.designation})` : ''}`).join(', ')}. Ask which one.`);
}

/** Names from a string or a list. */
export const namesOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean) : str(v, 120) ? [str(v, 120)] : []);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-12-01 as "1 Dec 2026". */
export const dayText = (d: string | null | undefined) => {
  if (!d || !isDay(d)) return d ?? '—';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Rupees (not paise) as ₹7,20,000. */
export const inr = (rupees: number) => `₹${Math.round(rupees).toLocaleString('en-IN')}`;

/** Runs each item, collecting failures (in the service's own words) instead of stopping. */
export async function runEach<T extends { name: string }>(items: T[], fn: (x: T) => Promise<unknown>, verb: string, noun = 'joiner') {
  const failed: string[] = [];
  for (const x of items) {
    try { await fn(x); } catch (e) { failed.push(`${x.name} (${(e as Error).message})`); }
  }
  const done = items.length - failed.length;
  if (!done && failed.length) throw new Error(`Nothing was done: ${failed.slice(0, 5).join('; ')}`);
  return { done, failed, message: `${verb} ${plural(done, noun)}.${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
}
