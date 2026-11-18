/**
 * Suwi's instant answers: the few questions HR asks most, answered straight
 * from the data the server already keeps (today's attendance report, the
 * company's waiting pile, a leave balance), with no language model at all.
 *
 *   who is on leave / absent / late / not punched in / missed a punch
 *     (today, yesterday, tomorrow for leave, or a named date)
 *   what is pending / waiting (on HR) / waiting the longest, optionally one type
 *   leave balance of <person>
 *
 * The matcher is deliberately narrow: a question with anything more in it (a
 * range, a threshold, a department, a "why") goes to the model as before, so an
 * instant answer is never a worse answer. It runs the same tools the model
 * would call, as the person asking, so access rules and numbers are identical;
 * it only skips the model's two rounds and the writing.
 */
import { addDays, dayLists, dayTables, type DayCategory } from './tools/attendance';
import { pendingTable } from './tools/requests';
import { SuwiContext, SuwiLink, SuwiTable, toolAllowed, toolByName } from './tools';
import { normalQuestion } from './kept';

export interface InstantAnswer {
  text: string;
  checked: string[];
  links: SuwiLink[];
  tables: SuwiTable[];
  /** Read from today's attendance (punches change it without a write hook): keep it a minute only. */
  live: boolean;
  kind: 'attendance' | 'pending' | 'balance';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fmt = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Anything that makes a question more than a plain lookup: those go to the model. */
const MORE = /\b(this|last|past|next) (week|month|year)|\bweek|\bmonth|\btimes\b|more than|at least|or more|\d+\s*\+|\bdepartment|\bteam\b|\bmanager|\bbetween\b|\bsince\b|\bfrom\b|\btrend|\bwhy\b|\bcompare|\baverage|\bweekday|\bmonday|\btuesday|\bwednesday|\bthursday|\bfriday|\bsaturday|\bsunday|\bexcept\b|\band not\b|\bbut not\b|\bnot on leave|\bpattern|\boften|\bmost\b(?! recent)|\bpercent|\bratio|\bremind|\bapprove|\bdecline|\breject|\bsafe\b|\boverdue|\bescalat|\bdraft|\bwrite|\bsend\b|\bemail|\bmessage|\bnext \d+|\bdays?\b|\bupcoming\b|\bcoming up\b/;
const ASKS = /^(who|which|list|show|tell|give|anyone|is anyone|are there|how many|what|whats|what's|any)\b/;

/** The date a question is about: today unless it names one; null when it names one we can't read. */
function dateOf(q: string, today: string): string | null {
  if (/\byesterday\b/.test(q)) return addDays(today, -1);
  if (/\btomorrow\b/.test(q)) return addDays(today, 1);
  const iso = q.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (named) {
    const [day, mon] = /^\d/.test(named[1]) ? [named[1], named[2]] : [named[2], named[1]];
    const m = MONTHS.indexOf(mon.slice(0, 3)) + 1;
    const d = Number(day);
    if (!m || d < 1 || d > 31) return null;
    const year = Number(today.slice(0, 4));
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/\b(on|for)\s+\d/.test(q)) return null;
  return today;
}

function attendanceCategories(q: string): DayCategory[] {
  const out: DayCategory[] = [];
  if (/\bon leave\b|\bleave (today|tomorrow|yesterday)\b|\b(off|away) today\b|\btaken leave\b|\bon (a )?(holiday|vacation)\b/.test(q)) out.push('onLeave');
  if (/\babsent\b/.test(q)) out.push('absent');
  if (/\blate\b/.test(q)) out.push('late');
  if (/missed (a |their |the )?punch|missing (a )?punch|forgot to punch|one punch/.test(q)) out.push('missedPunch');
  if (/not (yet )?(punched|clocked|checked) in|ha(ve|s)n'?t (yet )?(punched|clocked) in|yet to (punch|clock) in|not in yet|\bnot in (today|office)/.test(q)) out.push('notPunchedInYet');
  return out;
}

const PENDING_TYPE: [RegExp, string, string][] = [
  [/\bleave\b/, 'leave', 'leave'], [/\bovertime\b|\bot\b/, 'overtime', 'overtime'], [/\bcorrection/, 'corrections', 'correction'],
  [/\bcheck-?ins?\b|\bout of location\b|\bool\b/, 'checkins', 'checkin'], [/\bclaims?\b|\breimburse/, 'claims', 'claim'],
];

async function run(ctx: SuwiContext, name: string, input: Record<string, unknown>) {
  const tool = toolByName(name);
  if (!tool || !toolAllowed(ctx, tool)) return null;
  return { tool, out: await tool.run(ctx, input) };
}

/** The instant answer to this question, or null when it needs the model. */
export async function instantAnswer(ctx: SuwiContext, question: string): Promise<InstantAnswer | null> {
  const q = normalQuestion(question);
  if (q.length > 140) return null;

  // Leave balance of one person.
  const bal = q.match(/^(?:what(?:'?s| is)?\s+|show\s+(?:me\s+)?|check\s+)?(?:the\s+)?leave balances?\s+(?:of|for)\s+([a-z][a-z .'-]{1,60})$/) ?? q.match(/^(?:what(?:'?s| is)?\s+|show\s+(?:me\s+)?)?([a-z][a-z .'-]{1,60}?)'s leave balances?$/);
  if (bal) {
    const name = bal[1].replace(/\b(this year|now|today)\b/g, '').trim();
    if (!name || MORE.test(name)) return null;
    const r = await run(ctx, 'leave_balance', { name }).catch(() => null);
    if (!r) return null;
    const d = r.out.data as { name?: string; ambiguous?: boolean; candidates?: { name: string; department: string | null; employeeId: string | null }[]; balanceTracked?: boolean; types?: { name: string; total: number; used: number; remaining: number; pendingDays: number; leaveWithoutPay?: boolean }[]; year?: number };
    if (d.ambiguous) {
      return { kind: 'balance', live: false, checked: [r.tool.label({ name })], links: r.out.links ?? [],
        text: `Several people match "${name}". Ask again with the full name.`,
        tables: [{ title: 'People who match', columns: ['Name', 'Department', 'Employee ID'], rows: (d.candidates ?? []).map((c) => [c.name, c.department ?? '', c.employeeId ?? '']) }] };
    }
    const types = (d.types ?? []).filter((t) => !t.leaveWithoutPay);
    const text = !d.balanceTracked
      ? `${d.name}'s team doesn't track a leave balance: leave is approved without counting down.`
      : `${d.name}'s leave balance for ${d.year}: ${types.map((t) => `${t.remaining} ${t.name.toLowerCase()}`).join(', ') || 'no leave types set up'}.`;
    return { kind: 'balance', live: false, checked: [r.tool.label({ name })], links: r.out.links ?? [], text,
      tables: types.length ? [{ title: `Leave balance · ${d.name} · ${d.year}`, columns: ['Type', 'Total', 'Used', 'Left', 'Pending'], rows: types.map((t) => [t.name, t.total, t.used, t.remaining, t.pendingDays ? `${t.pendingDays} d` : '']) }] : [] };
  }

  if (!ASKS.test(q) || MORE.test(q)) return null;

  // Who is on leave / absent / late / not in / missed a punch, on one day.
  const cats = attendanceCategories(q);
  if (cats.length) {
    const date = dateOf(q, ctx.today);
    if (!date || (date > ctx.today && !(cats.length === 1 && cats[0] === 'onLeave'))) return null;
    const r = await run(ctx, 'attendance_summary', { from: date, to: date });
    if (!r) return null;
    const day = (r.out.data as { day?: ReturnType<typeof dayLists> }).day;
    if (!day) return null;
    const phrase: Record<DayCategory, (n: number) => string> = {
      onLeave: (n) => `${plural(n, 'person', 'people')} on leave`, absent: (n) => `${n} absent`, late: (n) => `${n} late`,
      missedPunch: (n) => `${n} with a missed punch`, notPunchedInYet: (n) => `${n} not punched in yet`,
    };
    const when = date === ctx.today ? 'Today' : date === addDays(ctx.today, -1) ? 'Yesterday' : date === addDays(ctx.today, 1) ? 'Tomorrow' : `On ${fmt(date)}`;
    const parts = cats.map((c) => phrase[c](day.counts[c]));
    const none = cats.every((c) => day.counts[c] === 0);
    const text = none
      ? `${when} (${fmt(date)}) nobody is ${cats.map((c) => ({ onLeave: 'on leave', absent: 'absent', late: 'late', missedPunch: 'missing a punch', notPunchedInYet: 'yet to punch in' }[c])).join(' or ')}.`
      : `${when} (${fmt(date)}): ${parts.join(', ')}.${(day as { cut?: string }).cut ? ` ${(day as { cut?: string }).cut}` : ''}`;
    return { kind: 'attendance', live: date >= ctx.today, checked: [r.tool.label({ from: date, to: date })], links: r.out.links ?? [], text, tables: dayTables(day, cats) };
  }

  // What is waiting on a decision (optionally one type, or only HR's turn).
  if (/\b(pending|waiting)\b/.test(q) && !/\bon me\b|\bmy\b|\bmine\b/.test(q)) {
    const matched = PENDING_TYPE.filter(([re]) => re.test(q));
    if (matched.length > 1) return null;
    const [, toolType, rowType] = matched[0] ?? [];
    const r = await run(ctx, 'pending_requests', toolType ? { type: toolType, limit: 200 } : { limit: 200 });
    if (!r) return null;
    type Row = { type: string; id: string; name: string; what: string; dates: string; daysWaiting: number };
    let rows = (r.out.data as { rows: Row[] }).rows;
    let label = r.tool.label(toolType ? { type: toolType } : {});
    if (/\bon hr\b|\bhr'?s (turn|call)\b|\bwith hr\b/.test(q)) {
      const { keptOrgSuwiDataAsync } = await import('./orgData');
      const kept = await keptOrgSuwiDataAsync(ctx.org, ctx.today, ctx.userId);
      if (!kept?.approvers) return null;
      rows = rows.filter((x) => x.type === 'claim' || !kept.approvers![`${x.type}:${x.id}`]?.managerUserId);
      label = `${label}, HR's turn`;
    }
    const what = rowType ? ({ leave: 'leave requests', overtime: 'overtime requests', correction: 'attendance corrections', checkin: 'out-of-location check-ins', claim: 'claims' } as Record<string, string>)[rowType] : 'requests';
    const oldest = rows[0];
    const text = rows.length
      ? `${rows.length} ${rows.length === 1 ? what.replace(/s$/, '') : what} waiting on a decision. The oldest is ${oldest.name}'s (${oldest.what.split(',')[0]}), waiting ${plural(oldest.daysWaiting, 'day')}.`
      : `Nothing is waiting on a decision${rowType ? ` in ${what}` : ''}.`;
    return { kind: 'pending', live: false, checked: [label], links: r.out.links ?? [], text, tables: rows.length ? [pendingTable(rows as never)] : [] };
  }
  return null;
}
