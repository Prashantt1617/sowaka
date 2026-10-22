// Shared by the attendance and shift tools: picking a team (a department, a
// manager's reports, a list of names or userIds), dates, and the sentence
// that says what a person's app will show. No tools are defined here.
import { users } from '../../config/db';
import { policyForUser, shiftPolicyViewOf } from '../../services/shift.service';
import { str, SuwiContext } from '../tools';

export const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Today in India, as the executors (which have no ctx) need it. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "2026-10-22" → "22 Oct 2026". */
export const niceDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** Weekday name of a YYYY-MM-DD. */
export const weekdayOf = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];

export interface TeamPerson { userId: string; name: string; department?: string; managerUserId?: string }

/** A date range from input: `from`/`to`, else the month to date. */
export function rangeOf(i: Record<string, unknown>, today: string) {
  const to = isDate(i.to) ? i.to : today;
  const from = isDate(i.from) ? i.from : `${to.slice(0, 7)}-01`;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Who a tool is about. Any of: `userIds`, `names` (each must match one
 * person), `department`, `manager` (a name or userId: their direct reports).
 * Several together narrow the pick. Says what it matched so the card can.
 */
export async function resolveTeam(ctx: SuwiContext, i: Record<string, unknown>): Promise<{ people: TeamPerson[]; how: string }> {
  const all = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, department: 1, managerUserId: 1 } }).toArray() as TeamPerson[];
  const byId = new Map(all.map((p) => [p.userId, p]));
  let picked: TeamPerson[] | null = null;
  const how: string[] = [];
  const narrow = (list: TeamPerson[]) => { picked = picked ? picked.filter((p) => list.some((q) => q.userId === p.userId)) : list; };

  const ids = Array.isArray(i.userIds) ? [...new Set(i.userIds.map(String))] : [];
  if (ids.length) {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`${missing.length} of those userIds are not active people in this company`);
    narrow(ids.map((id) => byId.get(id)!));
    how.push(`${ids.length} named`);
  }
  const names = Array.isArray(i.names) ? i.names.map((n) => str(n)).filter(Boolean) : [];
  if (names.length) {
    const found: TeamPerson[] = [];
    for (const n of names) {
      const k = norm(n);
      const exact = all.filter((p) => norm(p.name) === k);
      const loose = exact.length ? exact : all.filter((p) => norm(p.name).includes(k));
      if (!loose.length) throw new Error(`Nobody called "${n}" is on the active roll`);
      if (loose.length > 1) throw new Error(`"${n}" matches ${loose.length} people (${loose.slice(0, 5).map((p) => p.name).join(', ')}); give the full name or userId`);
      found.push(loose[0]);
    }
    narrow(found);
    how.push(found.map((p) => p.name).join(', '));
  }
  const dep = norm(i.department);
  if (dep) {
    const list = all.filter((p) => norm(p.department).includes(dep));
    if (!list.length) throw new Error(`No active people in a department matching "${str(i.department)}"`);
    narrow(list);
    how.push(`the ${str(i.department)} department`);
  }
  const mgr = str(i.manager);
  if (mgr) {
    const m = byId.get(mgr) ?? (() => {
      const k = norm(mgr);
      const exact = all.filter((p) => norm(p.name) === k);
      const loose = exact.length ? exact : all.filter((p) => norm(p.name).includes(k));
      if (loose.length > 1) throw new Error(`"${mgr}" matches ${loose.length} people; give the full name`);
      return loose[0];
    })();
    if (!m) throw new Error(`No manager called "${mgr}"`);
    const list = all.filter((p) => p.managerUserId === m.userId);
    if (!list.length) throw new Error(`${m.name} has no direct reports on the active roll`);
    narrow(list);
    how.push(`${m.name}'s reports`);
  }
  if (!picked) throw new Error('Say who: userIds, names, a department, or a manager');
  const people = picked as TeamPerson[];
  if (!people.length) throw new Error('Nobody matched all of those filters');
  return { people, how: how.join(' in ') };
}

/** "Their app shows Tech (11:00–20:00) from 23 Oct 2026." — read back from the real policy. */
export async function appShowsLine(userId: string, date: string, who = 'Their'): Promise<string> {
  const v = shiftPolicyViewOf(await policyForUser(userId, date));
  return `${who} app shows ${v.name} (${v.startTime}–${v.endTime}, punches by ${v.correction.punchFormat}) from ${niceDate(date)}.`;
}
